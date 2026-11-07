import {IntegrationFailure} from '../../../../platform/integrations/retry-policy.js';
import type { ChatPromptVariantId } from "@rag-study/contracts";
import type {
  AnswerControls,
  AnswerGenerator,
  ProviderTokenUsage,
  ProviderUsageObserver,
} from "../../application/ports/answer-generator.js";
import type { EmbeddingProvider } from "../../application/ports/embedding-provider.js";
import type { FaithfulnessJudge } from "../../../evaluations/index.js";
import type { Reranker } from "../../application/ports/reranker.js";
import { createGroundedAnswerPrompt } from "../../application/policies/grounded-answer-policy.js";
import {
  estimateChatCost,
  type ChatPricing,
} from "../../application/policies/chat-cost.js";
import {
  executionSignal,
  failExecutionBudget,
  workflowEffect,
} from "../../../../platform/workflows/execution-context.js";
import { WorkflowGuardError, WorkflowUsageOverrunError } from "../../../../platform/workflows/types.js";
import { planRerankerReservation, RerankerBudgetError, type RerankerBillingPolicy } from "../../application/policies/reranker-budget.js";
import { recordOperationalEvent } from "../../../../platform/observability/observer.js";

export class WorkflowAnswerGenerator implements AnswerGenerator {
  constructor(
    private readonly inner: AnswerGenerator,
    readonly checkpointKey: string,
    private readonly pricing: ChatPricing,
    private readonly maxOutputTokens: number,
  ) {}
  generate(
    question: string,
    context: string,
    signal?: AbortSignal,
    onUsage?: ProviderUsageObserver,
    previousQuestions?: readonly string[],
    variant?: ChatPromptVariantId,
    controls?: AnswerControls,
  ) {
    return this.invoke(
      question,
      context,
      signal,
      onUsage,
      previousQuestions,
      variant,
      controls,
    );
  }
  stream(
    question: string,
    context: string,
    onDelta: (delta: string) => void | Promise<void>,
    signal?: AbortSignal,
    onUsage?: ProviderUsageObserver,
    previousQuestions?: readonly string[],
    controls?: AnswerControls,
  ) {
    return this.invoke(
      question,
      context,
      signal,
      onUsage,
      previousQuestions,
      undefined,
      controls,
      onDelta,
    );
  }
  private async invoke(
    question: string,
    context: string,
    parent?: AbortSignal,
    onUsage?: ProviderUsageObserver,
    previousQuestions?: readonly string[],
    variant?: ChatPromptVariantId,
    controls?: AnswerControls,
    onDelta?: (delta: string) => void | Promise<void>,
  ) {
    const overrun = new AbortController();
    const activeSignal = executionSignal(parent);
    const signal = activeSignal
      ? AbortSignal.any([activeSignal, overrun.signal])
      : overrun.signal;
    signal.throwIfAborted();
    let streamedBytes = 0;
    const boundedDelta = async (delta: string) => {
      signal.throwIfAborted();
      streamedBytes += Buffer.byteLength(delta);
      if (streamedBytes > this.maxOutputTokens * 16 + 2_048) {
        const reason = new WorkflowGuardError("budget_exceeded");
        overrun.abort(reason);
        throw reason;
      }
      await onDelta?.(delta);
    };
    const prompt = createGroundedAnswerPrompt(
      question,
      context,
      previousQuestions,
      variant,
      controls,
    );
    const inputTokens =
      Buffer.byteLength(prompt.system) + Buffer.byteLength(prompt.user) + 128;
    const reservation = {
      calls: 1,
      inputTokens,
      outputTokens: this.maxOutputTokens,
      costMicros: Math.ceil(
        estimateChatCost(this.pricing, inputTokens, this.maxOutputTokens) *
          1_000_000,
      ),
    };
    const result = await workflowEffect(
      `chat:${this.checkpointKey}`,
      { prompt, maxOutputTokens: this.maxOutputTokens },
      reservation,
      async () => {
        let usage: ProviderTokenUsage | undefined;
        const observe = (value: ProviderTokenUsage) => {
          usage = value;
        };
        try {
          const answer =
            onDelta && this.inner.stream
              ? await this.inner.stream(
                  question,
                  context,
                  boundedDelta,
                  signal,
                  observe,
                  previousQuestions,
                  controls,
                )
              : await this.inner.generate(
                  question,
                  context,
                  signal,
                  observe,
                  previousQuestions,
                  variant,
                  controls,
                );
          signal?.throwIfAborted();
          if (
            (usage?.outputTokens ?? 0) > this.maxOutputTokens ||
            Buffer.byteLength(answer) > this.maxOutputTokens * 16 + 2_048
          )
            throw new WorkflowGuardError("budget_exceeded");
          return { ok: true as const, answer, usage };
        } catch (error) {
          signal?.throwIfAborted();
          if (error instanceof WorkflowGuardError||error instanceof IntegrationFailure) throw error;
          return { ok: false as const,usage };
        }
      },
    );
    if(result.usage)onUsage?.(result.usage);
    if (!result.ok)
      throw new Error("The provider could not produce an answer.");
    return result.answer;
  }
}

export class WorkflowEmbeddingProvider implements EmbeddingProvider {
  readonly forWorkspace: EmbeddingProvider["forWorkspace"];
  constructor(
    private readonly inner: EmbeddingProvider,
    private readonly identity: string,
    private readonly dimensions: number,
    private readonly inputCostPer1kUsd: number,
  ) {
    if (inner.forWorkspace)
      this.forWorkspace = async (tenantId, signal) => {
        const index = await inner.forWorkspace!(
          tenantId,
          executionSignal(signal),
        );
        return {
          ...index,
          provider: new WorkflowEmbeddingProvider(
            index.provider,
            JSON.stringify([index.identity, index.version]),
            index.identity.dimensions,
            inputCostPer1kUsd,
          ),
        };
      };
  }
  async embed(
    text: string,
    inputType: "document" | "query",
    parent?: AbortSignal,
  ): Promise<number[]> {
    const signal = executionSignal(parent),
      inputTokens = Buffer.byteLength(text);
    signal?.throwIfAborted();
    return workflowEffect(
      `embedding:${this.identity}`,
      { text, inputType, dimensions: this.dimensions },
      {
        calls: 1,
        inputTokens,
        costMicros: Math.ceil(
          (inputTokens / 1_000) * this.inputCostPer1kUsd * 1_000_000,
        ),
      },
      async () => {
        const vector = await this.inner.embed(text, inputType, signal);
        signal?.throwIfAborted();
        if (vector.length !== this.dimensions || !vector.every(Number.isFinite))
          throw new Error("Invalid embedding dimensions or values.");
        return vector;
      },
    );
  }
}

export class WorkflowFaithfulnessJudge implements FaithfulnessJudge {
  readonly model: string;
  constructor(
    private readonly inner: FaithfulnessJudge,
    private readonly pricing: ChatPricing,
  ) {
    this.model = inner.model;
  }
  async assess(
    input: Parameters<FaithfulnessJudge["assess"]>[0],
    parent: AbortSignal,
  ) {
    const signal = executionSignal(parent)!;
    signal.throwIfAborted();
    const inputTokens = Buffer.byteLength(JSON.stringify(input)) + 4_096;
    return workflowEffect(
      `judge:${this.model}`,
      input,
      {
        calls: 1,
        inputTokens,
        outputTokens: 900,
        costMicros: Math.ceil(
          estimateChatCost(this.pricing, inputTokens, 900) * 1_000_000,
        ),
      },
      () => this.inner.assess(input, signal),
    );
  }
}

export class WorkflowReranker implements Reranker {
  constructor(private readonly inner: Reranker, private readonly billing?: RerankerBillingPolicy) {}
  get enabled() {
    return this.inner.enabled;
  }
  async rerank(input: Parameters<Reranker["rerank"]>[0]) {
    const { signal: parent, onUsage, ...request } = input;
    const signal = executionSignal(parent);
    signal?.throwIfAborted();
    if (!input.candidates.length) return [];
    // A disabled local stage has no provider call or API-token reservation.
    if (!this.inner.enabled) return input.candidates.slice(0, input.limit);
    let plan: ReturnType<typeof planRerankerReservation>;
    try { plan = planRerankerReservation(input, this.billing); }
    catch (error) {
      if (error instanceof RerankerBudgetError) reportRerankerGuard(error.reason);
      throw error;
    }
    let overrun: WorkflowUsageOverrunError | undefined;
    const observe: ProviderUsageObserver = (usage) => {
      if (!Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0 || usage.inputTokens > 2_147_483_647 ||
          !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0 || usage.outputTokens > 2_147_483_647 ||
          (usage.costUsd !== undefined && (!Number.isFinite(usage.costUsd) || usage.costUsd < 0 || usage.costUsd > 999_999))) {
        reportRerankerGuard("reranker_invalid_usage");
        throw new RerankerBudgetError("reranker_invalid_usage");
      }
      if ((this.billing?.billing === "paid" && (usage.inputTokens > plan.inputTokens || usage.outputTokens > 0)) ||
          (usage.costUsd !== undefined && Math.ceil(usage.costUsd * 1_000_000) > plan.costMicros)) {
        overrun = new WorkflowUsageOverrunError();
        // Block new effects immediately, but let measured usage and the durable
        // terminal receipt settle before aborting any in-flight siblings.
        failExecutionBudget(overrun);
        try { onUsage?.(usage); } finally { throw overrun; }
      }
      onUsage?.(usage);
    };
    try {
      return await workflowEffect("rerank", { ...request, identity: plan.identity }, plan.amount, async () => {
        const result = await this.inner.rerank({ ...input, signal, onUsage: observe });
        if (overrun) throw overrun;
        signal?.throwIfAborted();
        return result;
      });
    } catch (error) {
      if (overrun) {
        // A repository error means the terminal commit could not be confirmed.
        // Keep the current scope stopped, but never claim a durable success.
        const failure = error instanceof WorkflowUsageOverrunError ? error : new WorkflowGuardError("effect_outcome_unknown");
        failExecutionBudget(failure, true);
        reportRerankerGuard(failure.code === "effect_outcome_unknown" ? "reranker_overrun_persistence_unknown" : overrun.reason);
        throw failure;
      }
      throw error;
    }
  }
}

function reportRerankerGuard(reason: string) {
  try { recordOperationalEvent({ operation: "provider_request", outcome: "invalid_usage", reason }); }
  catch { /* Diagnostic failures must not bypass the budget decision. */ }
}
