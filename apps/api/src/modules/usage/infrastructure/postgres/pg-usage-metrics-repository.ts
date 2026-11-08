import type { Pool } from "pg";
import type {
  UsageMetricsRepository,
  UsageSummary,
} from "../../application/ports/usage-metrics-repository.js";
import { createHash } from "node:crypto";
import { currentExecution } from "../../../../platform/workflows/execution-context.js";
import { recordOperationalUsage } from "../../../../platform/observability/observer.js";
import { z } from "zod";
import {
  usageModelSchema, usageOperationSchema, usageDaySchema,
} from "@rag-study/contracts";
import {
  decodeStoredRecord, StoredRecordError,
} from "../../../../platform/database/stored-record.js";

// PostgreSQL returns aggregate numerics as text. Only genuine numeric values
// may become measurements; SQL COALESCE, rather than this decoder, owns zeros.
const amount = z.union([
  z.number(),
  z.string().max(80).regex(/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i).transform(Number),
]).pipe(z.number().finite().nonnegative());
const count = amount.pipe(z.number().int());
const summaryFields = z.object({
  requests: count,
  cache_hits: count,
  input_tokens: count,
  output_tokens: count,
  estimated_cost_usd: amount,
  average_latency_ms: amount,
  provider_failures: count,
  observed_requests: count,
  observed_cost_usd: amount,
  effective_cost_usd: amount,
  estimated_only_cost_usd: amount,
  observed_cost_requests: count,
  estimated_cost_requests: count,
  skipped_requests: count,
  observed_input_tokens: count,
  observed_output_tokens: count,
  estimated_input_tokens: count,
  estimated_output_tokens: count,
  p95_latency_ms: amount,
  unpriced_requests: count,
  extended_since: z.date().nullable(),
  window_start: z.date(),
  window_end: z.date(),
});
const summaryRowSchema = z.discriminatedUnion("bucket", [
  summaryFields.extend({ bucket: z.literal("total") }),
  summaryFields.extend({
    bucket: z.literal("model"),
    provider: usageModelSchema.shape.provider,
    model: usageModelSchema.shape.model,
  }),
  summaryFields.extend({
    bucket: z.literal("operation"), operation: usageOperationSchema.shape.operation,
  }),
  summaryFields.extend({ bucket: z.literal("day"), day: usageDaySchema.shape.date }),
]);
type SummaryRow = z.output<typeof summaryRowSchema>;

function totals(row: SummaryRow) {
  return {
    requests: row.requests,
    cacheHits: row.cache_hits,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedCostUsd: row.estimated_cost_usd,
    averageLatencyMs: row.average_latency_ms,
    providerFailures: row.provider_failures,
    observedRequests: row.observed_requests,
    observedCostUsd: row.observed_cost_usd,
    effectiveCostUsd: row.effective_cost_usd,
    estimatedOnlyCostUsd: row.estimated_only_cost_usd,
    observedCostRequests: row.observed_cost_requests,
    estimatedCostRequests: row.estimated_cost_requests,
    skippedRequests: row.skipped_requests,
    observedInputTokens: row.observed_input_tokens,
    observedOutputTokens: row.observed_output_tokens,
    estimatedInputTokens: row.estimated_input_tokens,
    estimatedOutputTokens: row.estimated_output_tokens,
    p95LatencyMs: row.p95_latency_ms,
    unpricedRequests: row.unpriced_requests,
  };
}

export class PgUsageMetricsRepository implements UsageMetricsRepository {
  constructor(private readonly pool: Pool) {}

  async record(
    input: Parameters<UsageMetricsRepository["record"]>[0],
  ): Promise<void> {
    const execution = currentExecution();
    const recordKey = execution
      ? createHash("sha256")
          .update(
            JSON.stringify([
              execution.node,
              input.operation,
              input.provider,
              input.model,
              input.promptVersion,
              ...(input.idempotencyKey ? [input.idempotencyKey] : []),
            ]),
          )
          .digest("hex")
      : null;
    const inserted = await this.pool.query(
      `INSERT INTO ai_usage_events (tenant_id, actor_key, operation, provider, model, cache_hit, input_tokens, output_tokens, latency_ms, estimated_cost_usd, failed,
                                    usage_source, observed_cost_usd, prompt_version, citation_count, safety_outcome,workflow_run_id,workflow_record_key,pricing_known,measurement_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,2)
       ON CONFLICT(tenant_id,workflow_run_id,workflow_record_key) WHERE workflow_run_id IS NOT NULL DO NOTHING RETURNING id`,
      [
        input.tenantId,
        input.actorKey,
        input.operation,
        input.provider,
        input.model,
        input.cacheHit,
        input.inputTokens,
        input.outputTokens,
        input.latencyMs,
        input.estimatedCostUsd,
        input.failed,
        input.source ?? "estimated",
        input.observedCostUsd ?? null,
        input.promptVersion ?? null,
        input.citationCount ?? 0,
        input.safetyOutcome ?? null,
        execution?.lease.runId ?? null,
        recordKey,
        input.pricingKnown ?? null,
      ],
    );
    if (inserted.rowCount)
      recordOperationalUsage({
        provider: input.provider,
        model: input.model,
        operation: input.operation,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        source: input.source ?? "estimated",
        costSource:
          input.observedCostUsd !== undefined
            ? "reported"
            : input.pricingKnown === false
              ? "unknown"
              : "estimated",
        costUsd: input.observedCostUsd ?? input.estimatedCostUsd,
      });
  }

  async summarize(input: {
    tenantId: string;
    days: number;
  }): Promise<UsageSummary> {
    if (!Number.isInteger(input.days) || input.days < 1 || input.days > 90)
      throw new Error("Usage window must be between 1 and 90 days.");
    // One snapshot reconciles totals, model/operation breakdowns and UTC daily buckets.
    // The existing (tenant_id, created_at) index bounds the scan before aggregation.
    const result = await this.pool.query(
      `WITH scoped AS (
         SELECT provider,model,operation,(created_at AT TIME ZONE 'UTC')::date::text AS day,
           cache_hit,input_tokens,output_tokens,latency_ms,estimated_cost_usd,observed_cost_usd,usage_source,failed,pricing_known,measurement_version,created_at
         FROM ai_usage_events
         WHERE tenant_id=$1 AND created_at>=NOW()-($2*INTERVAL '1 day') AND created_at<=NOW()
       )
       SELECT CASE WHEN GROUPING(provider)=0 THEN 'model' WHEN GROUPING(operation)=0 THEN 'operation'
                   WHEN GROUPING(day)=0 THEN 'day' ELSE 'total' END AS bucket,
         provider,model,operation,day,
         COUNT(*)::text AS requests,COUNT(*) FILTER(WHERE cache_hit)::text AS cache_hits,
         COALESCE(SUM(input_tokens),0)::text AS input_tokens,COALESCE(SUM(output_tokens),0)::text AS output_tokens,
         COALESCE(SUM(estimated_cost_usd),0)::text AS estimated_cost_usd,
         COALESCE(SUM(observed_cost_usd),0)::text AS observed_cost_usd,
         COALESCE(SUM(estimated_cost_usd) FILTER(WHERE observed_cost_usd IS NULL),0)::text AS estimated_only_cost_usd,
         COALESCE(SUM(COALESCE(observed_cost_usd,estimated_cost_usd)),0)::text AS effective_cost_usd,
         COUNT(*) FILTER(WHERE usage_source='observed')::text AS observed_requests,
         COUNT(*) FILTER(WHERE observed_cost_usd IS NOT NULL)::text AS observed_cost_requests,
         COUNT(*) FILTER(WHERE observed_cost_usd IS NULL AND pricing_known IS DISTINCT FROM false AND NOT cache_hit AND usage_source IN ('estimated','observed'))::text AS estimated_cost_requests,
         COUNT(*) FILTER(WHERE usage_source='none')::text AS skipped_requests,
         COUNT(*) FILTER(WHERE pricing_known=false AND observed_cost_usd IS NULL)::text AS unpriced_requests,
         MIN(created_at) FILTER(WHERE measurement_version=2) AS extended_since,
         COALESCE(SUM(input_tokens) FILTER(WHERE usage_source='observed'),0)::text AS observed_input_tokens,
         COALESCE(SUM(output_tokens) FILTER(WHERE usage_source='observed'),0)::text AS observed_output_tokens,
         COALESCE(SUM(input_tokens) FILTER(WHERE usage_source='estimated'),0)::text AS estimated_input_tokens,
         COALESCE(SUM(output_tokens) FILTER(WHERE usage_source='estimated'),0)::text AS estimated_output_tokens,
         COALESCE(AVG(latency_ms),0)::text AS average_latency_ms,
         COALESCE(percentile_cont(0.95) WITHIN GROUP(ORDER BY latency_ms),0)::text AS p95_latency_ms,
         COUNT(*) FILTER(WHERE failed)::text AS provider_failures,
         (NOW()-($2*INTERVAL '1 day')) AS window_start,NOW() AS window_end
       FROM scoped GROUP BY GROUPING SETS ((),(provider,model),(operation),(day))`,
      [input.tenantId, input.days],
    );
    const rows = decodeStoredRecord(z.array(summaryRowSchema), result.rows);
    const total = rows.find((row) => row.bucket === "total");
    if (!total || rows.filter((row) => row.bucket === "total").length !== 1)
      throw new StoredRecordError();
    const cost = (row: ReturnType<typeof totals>) => row.effectiveCostUsd;
    return {
      ...totals(total),
      ...(total.extended_since
        ? { extendedSince: total.extended_since.toISOString() }
        : {}),
      models: rows
        .filter((row) => row.bucket === "model")
        .map((row) => ({
          ...totals(row),
          provider: row.provider,
          model: row.model,
        }))
        .sort(
          (a, b) =>
            cost(b) - cost(a) ||
            a.provider.localeCompare(b.provider) ||
            a.model.localeCompare(b.model),
        ),
      operations: rows
        .filter((row) => row.bucket === "operation")
        .map((row) => ({ ...totals(row), operation: row.operation }))
        .sort(
          (a, b) => cost(b) - cost(a) || a.operation.localeCompare(b.operation),
        ),
      daily: rows
        .filter((row) => row.bucket === "day")
        .map((row) => ({ ...totals(row), date: row.day }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      windowStart: total.window_start.toISOString(),
      windowEnd: total.window_end.toISOString(),
    };
  }
}
