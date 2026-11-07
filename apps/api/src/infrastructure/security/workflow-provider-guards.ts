import type { ChatPromptVariantId } from "@rag-study/contracts";
import type {
  AnswerControls,
  AnswerGenerator,
  ProviderTokenUsage,
  ProviderUsageObserver,
} from "../../application/ports/answer-generator.js";
import type { EmbeddingProvider } from "../../application/ports/embedding-provider.js";
import type { FaithfulnessJudge } from "../../application/evaluation/public-faithfulness.js";
import type { Reranker } from "../../application/ports/reranker.js";
import { createGroundedAnswerPrompt } from "../../application/policies/grounded-answer-policy.js";
import {
  estimateChatCost,
  type ChatPricing,
} from "../../application/policies/chat-cost.js";
import {
  executionSignal,
  workflowEffect,
} from "../../application/workflows/execution-context.js";
import { WorkflowGuardError } from "../../application/workflows/types.js";

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
          if (error instanceof WorkflowGuardError) throw error;
          return { ok: false as const };
        }
      },
    );
    if (!result.ok)
      throw new Error("The provider could not produce an answer.");
    if (result.usage) onUsage?.(result.usage);
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
  constructor(private readonly inner: Reranker) {}
  get enabled() {
    return this.inner.enabled;
  }
  rerank(...args: Parameters<Reranker["rerank"]>) {
    const [input] = args;
    const { signal, ...request } = input;
    return workflowEffect(
      "rerank",
      request,
      {
        calls: 1,
        inputTokens: Buffer.byteLength(JSON.stringify(request)),
        costMicros: 1_000,
      },
      () => this.inner.rerank({ ...input, signal: executionSignal(signal) }),
    );
  }
}
