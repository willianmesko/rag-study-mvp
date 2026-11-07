import {withProviderUsageScope} from "../../../../platform/observability/provider-usage-context.js";
import type { ChatModelDescriptor, ChatPromptDescriptor, ChatPromptVariantId } from "@rag-study/contracts";
import type { AnswerGenerator, ProviderTokenUsage } from "../../../ai/index.js";
import type { AnswerQuestionResult, PreparedAnswerContext, PreparedAnswerWorkflow } from "../ports/question-answering-workflow.js";
import type { UsageMetricsRepository } from "../../../usage/index.js";
import { withExecutionTimeout } from "../../../mcp/index.js";
import { ChatBudgetExceededError, estimateChatCost, type ChatPricing } from "../../../ai/index.js";
import { describeAnswerUsage } from "../policies/answer-usage.js";
import { chatPromptDescriptors, estimateGroundedPromptTokens, reserveGroundedPromptTokens } from "../../../ai/index.js";
import { redactPii } from "../../../../platform/security/pii-redaction.js";
import { withTransientBudget } from '../../../../platform/workflows/transient-budget.js';

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
  promptVariantIds?: readonly [ChatPromptVariantId, ChatPromptVariantId];
  signal?: AbortSignal;
};

type ComparisonResult = {
  model: ChatModelDescriptor;
  providerModel: string;
  prompt: ChatPromptDescriptor;
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

  execute(input: CompareInput): Promise<[ComparisonResult, ComparisonResult]> {
    return withProviderUsageScope({tenantId:input.tenantId,actorKey:input.actorKey},()=>withTransientBudget({maxSteps:50,maxCalls:16,maxInputTokens:320_000,maxOutputTokens:Math.min(64_000,this.options.maxOutputTokens*4+3_600),maxCostMicros:Math.ceil(this.options.maxEstimatedCostUsd*1_000_000),timeoutMs:this.options.timeoutMs},()=>this.run(input)));
  }
  private async run(input: CompareInput): Promise<[ComparisonResult, ComparisonResult]> {
    const startedAt = performance.now();
    const question = redactPii(input.question).text;
    const variants = input.promptVariantIds ?? ["balanced", "balanced"];
    const prepared = await withExecutionTimeout((signal) =>
      this.workflow.prepare({ question, topK: input.topK, tenantId: input.tenantId, signal }), this.options.timeoutMs, input.signal);
    input.signal?.throwIfAborted();
    if (prepared) {
      const maximum = input.models.reduce((total, model, index) => total + estimateChatCost(model,
        reserveGroundedPromptTokens(prepared.question, prepared.context.text, prepared.previousQuestions, variants[index]), this.options.maxOutputTokens), 0);
      if (maximum > this.options.maxEstimatedCostUsd) throw new ChatBudgetExceededError();
    }
    const remainingMs = Math.max(1, this.options.timeoutMs - Math.ceil(performance.now() - startedAt));
    return Promise.all([
      this.generate(input, prepared, input.models[0], remainingMs, variants[0]!),
      this.generate(input, prepared, input.models[1], remainingMs, variants[1]!)
    ]);
  }

  private async generate(input: CompareInput, prepared: PreparedAnswerContext | null, model: ComparisonModel, timeoutMs: number, variant: ChatPromptVariantId): Promise<ComparisonResult> {
    const startedAt = performance.now();
    let response: AnswerQuestionResult | null = null;
    let error: ComparisonResult["error"] = null;
    let providerUsage: ProviderTokenUsage | undefined;
    const prompt = chatPromptDescriptors.find(({ id }) => id === variant)!;
    const estimatedInputTokens = prepared ? estimateGroundedPromptTokens(prepared.question, prepared.context.text, prepared.previousQuestions, variant) : 0;
    const generator: AnswerGenerator = {checkpointKey:`${model.descriptor.id}:${variant}`,generate: (question, context, signal, onUsage, previousQuestions,_variant,controls) =>
      model.generator.generate(question, context, signal, onUsage, previousQuestions, variant,controls) };
    try {
      response = await withExecutionTimeout((signal) =>
        this.workflow.answerPrepared(prepared, generator, signal, (usage) => { providerUsage = usage; }), timeoutMs, input.signal);
      if (prepared) response = { ...response, estimatedInputTokens };
    } catch {
      input.signal?.throwIfAborted();
      error = "generation_failed";
    }
    input.signal?.throwIfAborted();
    const usage = describeAnswerUsage(response, model, performance.now() - startedAt, estimatedInputTokens, providerUsage, prompt.version);
    await this.usage.record({
      tenantId: input.tenantId, actorKey: input.actorKey, operation: "question_comparison",
      provider: model.descriptor.provider, model: model.model, cacheHit: false,
      ...usage, failed: error !== null
    });
    return { model: model.descriptor, providerModel: model.model, prompt, response: response ? { ...response, usage } : null, error, latencyMs: usage.latencyMs, estimatedCostUsd: usage.estimatedCostUsd };
  }
}
