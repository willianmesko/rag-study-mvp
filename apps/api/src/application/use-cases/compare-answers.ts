import type { ChatModelDescriptor } from "@rag-study/contracts";
import type { AnswerGenerator } from "../ports/answer-generator.js";
import type { AnswerQuestionResult, PreparedAnswerContext, PreparedAnswerWorkflow } from "../ports/question-answering-workflow.js";
import type { UsageMetricsRepository } from "../ports/usage-metrics-repository.js";
import { withExecutionTimeout } from "../policies/agent-execution-policy.js";
import { ChatBudgetExceededError, estimateChatCost, type ChatPricing } from "../policies/chat-cost.js";
import { redactPii } from "../../domain/security/pii-redaction.js";

export type ComparisonModel = ChatPricing & {
  descriptor: ChatModelDescriptor;
  model: string;
  generator: AnswerGenerator;
};

type CompareInput = {
  question: string;
  topK?: number;
  tenantId: string;
  actorKey: string;
  models: readonly [ComparisonModel, ComparisonModel];
  signal?: AbortSignal;
};

type ComparisonResult = {
  model: ChatModelDescriptor;
  response: AnswerQuestionResult | null;
  error: "generation_failed" | null;
  latencyMs: number;
  estimatedCostUsd: number;
};

export class CompareAnswersUseCase {
  constructor(
    private readonly workflow: PreparedAnswerWorkflow,
    private readonly usage: Pick<UsageMetricsRepository, "record">,
    private readonly options: { timeoutMs: number; maxOutputTokens: number; maxEstimatedCostUsd: number }
  ) {}

  async execute(input: CompareInput): Promise<[ComparisonResult, ComparisonResult]> {
    const startedAt = performance.now();
    const question = redactPii(input.question).text;
    const prepared = await withExecutionTimeout((signal) =>
      this.workflow.prepare({ question, topK: input.topK, tenantId: input.tenantId, signal }), this.options.timeoutMs, input.signal);
    input.signal?.throwIfAborted();
    if (prepared) {
      const maximum = input.models.reduce((total, model) =>
        total + estimateChatCost(model, prepared.estimatedInputTokens, this.options.maxOutputTokens), 0);
      if (maximum > this.options.maxEstimatedCostUsd) throw new ChatBudgetExceededError();
    }
    const remainingMs = Math.max(1, this.options.timeoutMs - Math.ceil(performance.now() - startedAt));
    return Promise.all([
      this.generate(input, prepared, input.models[0], remainingMs),
      this.generate(input, prepared, input.models[1], remainingMs)
    ]);
  }

  private async generate(input: CompareInput, prepared: PreparedAnswerContext | null, model: ComparisonModel, timeoutMs: number): Promise<ComparisonResult> {
    const startedAt = performance.now();
    let response: AnswerQuestionResult | null = null;
    let error: ComparisonResult["error"] = null;
    try {
      response = await withExecutionTimeout((signal) =>
        this.workflow.answerPrepared(prepared, model.generator, signal), timeoutMs, input.signal);
    } catch {
      input.signal?.throwIfAborted();
      error = "generation_failed";
    }
    input.signal?.throwIfAborted();
    const latencyMs = Math.round(performance.now() - startedAt);
    const inputTokens = response?.estimatedInputTokens ?? prepared?.estimatedInputTokens ?? 0;
    const outputTokens = response?.estimatedOutputTokens ?? 0;
    const estimatedCostUsd = estimateChatCost(model, inputTokens, outputTokens);
    await this.usage.record({
      tenantId: input.tenantId, actorKey: input.actorKey, operation: "question_comparison",
      provider: model.descriptor.provider, model: model.model, cacheHit: false,
      inputTokens, outputTokens, latencyMs, estimatedCostUsd, failed: error !== null
    });
    return { model: model.descriptor, response, error, latencyMs, estimatedCostUsd };
  }
}
