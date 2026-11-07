import type { EmbeddingProvider } from "../../../ai/index.js";
import type { EmbeddingModelIdentity } from "../../../ai/index.js";
import type {
  ProviderTokenUsage,
  ProviderUsageObserver,
  AnswerGenerator,
} from "../../../ai/index.js";
import type { Reranker } from "../../../ai/index.js";
import type { FaithfulnessJudge } from "../../../evaluations/index.js";
import type { UsageMetricsRepository } from "../ports/usage-metrics-repository.js";
import { currentExecution } from "../../../../platform/workflows/execution-context.js";
import {
  currentProviderUsageScope,
  currentProviderReceipt,
} from "../../../../platform/observability/provider-usage-context.js";
import {
  observeOperation,
  recordOperationalEvent,
} from "../../../../platform/observability/observer.js";
import { IntegrationFailure } from "../../../../platform/integrations/retry-policy.js";
import { WorkflowGuardError } from "../../../../platform/workflows/types.js";
type Metadata = {
  provider: string;
  model: string;
  inputPrice?: number;
  outputPrice?: number;
  tenantId?: string;
};

export class ProviderMeasurements {
  constructor(private readonly ledger: UsageMetricsRepository) {}
  async call<T>(
    meta: Metadata,
    operation: string,
    estimatedInput: number,
    work: (observe: ProviderUsageObserver) => Promise<T>,
  ): Promise<T> {
    const execution = currentExecution(),
      ambient = currentProviderUsageScope();
    const scope = execution
      ? {
          tenantId: execution.lease.tenantId,
          actorKey:
            execution.lease.kind === "ingestion"
              ? "system:ingestion"
              : `user:${execution.lease.actorId}`,
        }
      : (ambient ??
        (meta.tenantId
          ? { tenantId: meta.tenantId, actorKey: "system:provider" }
          : null));
    if (meta.tenantId && scope && meta.tenantId !== scope.tenantId)
      throw new WorkflowGuardError("authorization_revoked");
    const invoke = async () => {
      const started = performance.now();
      let native: ProviderTokenUsage | undefined,
        failed = false,
        rejected = false,
        resultForEstimate: unknown;
      try {
        const result = await work((value) => {
          if (
            !Number.isInteger(value.inputTokens) ||
            value.inputTokens < 0 ||
            value.inputTokens > 2_147_483_647 ||
            !Number.isInteger(value.outputTokens) ||
            value.outputTokens < 0 ||
            value.outputTokens > 2_147_483_647 ||
            (value.costUsd !== undefined &&
              (!Number.isFinite(value.costUsd) ||
                value.costUsd < 0 ||
                value.costUsd > 999_999))
          ) {
            recordOperationalEvent({
              operation: "provider_request",
              outcome: "invalid_usage",
              reason: "invalid_usage_metadata",
            });
            return;
          }
          native = value;
        });
        resultForEstimate = result;
        return result;
      } catch (error) {
        failed = true;
        rejected =
          error instanceof IntegrationFailure &&
          ["rate_limited", "permanent_rejection"].includes(error.code);
        throw error;
      } finally {
        if (scope) {
          const inputTokens =
              native?.inputTokens ?? (rejected ? 0 : estimatedInput),
            outputTokens =
              native?.outputTokens ??
              (resultForEstimate !== undefined &&
              [
                "evaluation_generation",
                "evidence_judging",
                "evaluation_judging",
              ].includes(operation)
                ? Math.ceil(
                    Buffer.byteLength(
                      typeof resultForEstimate === "string"
                        ? resultForEstimate
                        : JSON.stringify(resultForEstimate),
                    ) / 4,
                  )
                : 0);
          const pricingKnown =
            rejected ||
            native?.costUsd !== undefined ||
            (meta.inputPrice !== undefined && meta.outputPrice !== undefined) ||
            (meta.inputPrice !== undefined && outputTokens === 0);
          await this.ledger.record({
            ...scope,
            operation,
            provider: meta.provider,
            model: meta.model,
            cacheHit: false,
            inputTokens,
            outputTokens,
            latencyMs: Math.max(0, Math.round(performance.now() - started)),
            estimatedCostUsd: Math.max(
              0,
              (inputTokens * (meta.inputPrice ?? 0) +
                outputTokens * (meta.outputPrice ?? 0)) /
                1000,
            ),
            observedCostUsd: native?.costUsd,
            pricingKnown,
            source: native ? "observed" : rejected ? "none" : "estimated",
            failed,
            idempotencyKey: currentProviderReceipt(),
          });
        }
      }
    };
    return currentProviderReceipt()
      ? invoke()
      : observeOperation({ kind: "provider.call", name: operation }, invoke);
  }
  embedding(
    inner: EmbeddingProvider,
    identity: EmbeddingModelIdentity,
    tenantId?: string,
    inputPrice?: number,
  ): EmbeddingProvider {
    return {
      embed: (text, type, signal, onUsage) =>
        this.call(
          { ...identity, tenantId, inputPrice },
          `embedding_${type}`,
          Math.ceil(Buffer.byteLength(text) / 4),
          (observe) =>
            inner.embed(text, type, signal, (usage) => {
              observe(usage);
              onUsage?.(usage);
            }),
        ),
    };
  }
  reranker(inner: Reranker, meta: Metadata): Reranker {
    return {
      enabled: inner.enabled,
      rerank: (input) =>
        input.candidates.length
          ? this.call(
              meta,
              "reranking",
              Math.ceil(
                Buffer.byteLength(
                  input.query +
                    input.candidates.map(({ content }) => content).join(""),
                ) / 4,
              ),
              (observe) =>
                inner.rerank({
                  ...input,
                  onUsage: (usage) => {
                    observe(usage);
                    input.onUsage?.(usage);
                  },
                }),
            )
          : Promise.resolve([]),
    };
  }
  judge(
    inner: FaithfulnessJudge,
    meta: Metadata,
    operation: "evidence_judging" | "evaluation_judging",
  ): FaithfulnessJudge {
    return {
      model: inner.model,
      assess: (input, signal, onUsage) =>
        this.call(
          meta,
          operation,
          Math.ceil(Buffer.byteLength(JSON.stringify(input)) / 4),
          (observe) =>
            inner.assess(input, signal, (usage) => {
              observe(usage);
              onUsage?.(usage);
            }),
        ),
    };
  }
  evaluationGenerator(inner: AnswerGenerator, meta: Metadata): AnswerGenerator {
    const measure = (
      estimate: number,
      work: (observe?: ProviderUsageObserver) => Promise<string>,
      onUsage?: ProviderUsageObserver,
    ) =>
      currentExecution()?.lease.kind === "evaluation" ||
      currentProviderUsageScope()?.purpose === "evaluation"
        ? this.call(meta, "evaluation_generation", estimate, (observe) =>
            work((usage) => {
              observe(usage);
              onUsage?.(usage);
            }),
          )
        : work(onUsage);
    return {
      checkpointKey: inner.checkpointKey,
      generate: (
        question,
        context,
        signal,
        onUsage,
        previous,
        variant,
        controls,
      ) =>
        measure(
          Math.ceil(Buffer.byteLength(question + context) / 4),
          (observe) =>
            inner.generate(
              question,
              context,
              signal,
              observe,
              previous,
              variant,
              controls,
            ),
          onUsage,
        ),
      ...(inner.stream
        ? {
            stream: ((
              question,
              context,
              onDelta,
              signal,
              onUsage,
              previous,
              controls,
            ) =>
              measure(
                Math.ceil(Buffer.byteLength(question + context) / 4),
                (observe) =>
                  inner.stream!(
                    question,
                    context,
                    onDelta,
                    signal,
                    observe,
                    previous,
                    controls,
                  ),
                onUsage,
              )) as NonNullable<AnswerGenerator["stream"]>,
          }
        : {}),
    };
  }
}
