import type { Pool } from "pg";
import type { UsageMetricsRepository, UsageSummary } from "../../application/ports/usage-metrics-repository.js";

type SummaryRow = { requests: string; cache_hits: string; input_tokens: string; output_tokens: string; estimated_cost_usd: string; average_latency_ms: string; provider_failures: string; observed_requests: string; observed_cost_usd: string; effective_cost_usd: string };

export class PgUsageMetricsRepository implements UsageMetricsRepository {
  constructor(private readonly pool: Pool) {}

  async record(input: Parameters<UsageMetricsRepository["record"]>[0]): Promise<void> {
    await this.pool.query(
      `INSERT INTO ai_usage_events (tenant_id, actor_key, operation, provider, model, cache_hit, input_tokens, output_tokens, latency_ms, estimated_cost_usd, failed,
                                    usage_source, observed_cost_usd, prompt_version, citation_count, safety_outcome)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [input.tenantId, input.actorKey, input.operation, input.provider, input.model, input.cacheHit, input.inputTokens, input.outputTokens, input.latencyMs, input.estimatedCostUsd, input.failed,
        input.source ?? "estimated", input.observedCostUsd ?? null, input.promptVersion ?? null, input.citationCount ?? 0, input.safetyOutcome ?? null]
    );
  }

  async summarize(input: { tenantId: string; days: number }): Promise<UsageSummary> {
    const result = await this.pool.query<SummaryRow>(
      `SELECT COUNT(*)::text AS requests, COUNT(*) FILTER (WHERE cache_hit)::text AS cache_hits,
              COALESCE(SUM(input_tokens), 0)::text AS input_tokens, COALESCE(SUM(output_tokens), 0)::text AS output_tokens,
              COALESCE(SUM(estimated_cost_usd), 0)::text AS estimated_cost_usd,
              COALESCE(AVG(latency_ms), 0)::text AS average_latency_ms,
              COUNT(*) FILTER (WHERE usage_source = 'observed')::text AS observed_requests,
              COALESCE(SUM(observed_cost_usd), 0)::text AS observed_cost_usd,
              COALESCE(SUM(COALESCE(observed_cost_usd, estimated_cost_usd)), 0)::text AS effective_cost_usd,
              COUNT(*) FILTER (WHERE failed)::text AS provider_failures
       FROM ai_usage_events WHERE tenant_id = $1 AND created_at >= NOW() - ($2 * INTERVAL '1 day')`,
      [input.tenantId, input.days]
    );
    const row = result.rows[0];
    return {
      requests: Number(row?.requests ?? 0), cacheHits: Number(row?.cache_hits ?? 0), inputTokens: Number(row?.input_tokens ?? 0),
      outputTokens: Number(row?.output_tokens ?? 0), estimatedCostUsd: Number(row?.estimated_cost_usd ?? 0),
      averageLatencyMs: Number(row?.average_latency_ms ?? 0), providerFailures: Number(row?.provider_failures ?? 0),
      observedRequests: Number(row?.observed_requests ?? 0), observedCostUsd: Number(row?.observed_cost_usd ?? 0),
      effectiveCostUsd: Number(row?.effective_cost_usd ?? 0)
    };
  }
}
