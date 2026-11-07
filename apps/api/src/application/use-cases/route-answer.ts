import type { ChatAnswerRouting } from "@rag-study/contracts";
import type { ProviderTokenUsage } from "../ports/answer-generator.js";
import type { AnswerQuestionResult, AnswerWorkflowEvent, PreparedAnswerWorkflow } from "../ports/question-answering-workflow.js";
import type { UsageMetricsRepository } from "../ports/usage-metrics-repository.js";
import { withExecutionTimeout } from "../policies/agent-execution-policy.js";
import { describeAnswerUsage } from "../policies/answer-usage.js";
import { ChatBudgetExceededError, estimateChatCost } from "../policies/chat-cost.js";
import { conversationPromptVersion, groundedPromptVersion, reserveGroundedPromptTokens } from "../policies/grounded-answer-policy.js";
import { preparePreviousQuestions } from "../policies/conversation-context.js";
import { redactPii } from "../../domain/security/pii-redaction.js";
import type { ComparisonModel } from "./compare-answers.js";
import { withTransientBudget } from '../workflows/transient-budget.js';
import { WorkflowGuardError } from '../workflows/types.js';

type AutoInput = {
  question: string;
  previousQuestions?: readonly string[];
  topK?: number;
  tenantId: string;
  actorKey: string;
  simple: ComparisonModel;
  complex: ComparisonModel;
  fallbacks: ComparisonModel[];
  reserveFallbackQuota: (modelId?:string) => Promise<boolean>;
  signal?: AbortSignal;
  onEvent?: (event: AnswerWorkflowEvent) => void | Promise<void>;
};

export class AutoAnswerFailedError extends Error {
  constructor() {
    super("The automatic model route could not generate an answer. Try again or choose a model.");
    this.name = "AutoAnswerFailedError";
  }
}

export function classifyQuestion(question: string): ChatAnswerRouting["reason"] {
  const wordCount = question.trim().split(/\s+/u).length;
  const multipleQuestions = (question.match(/\?/gu)?.length ?? 0) > 1;
  const normalized = question.normalize("NFD").replace(/\p{M}/gu, "");
  const analyticalRequest = /\b(compare|contrast|analy[sz]e|evaluate|synthesi[sz]e|trade-offs?|comparar|analise|analisar|avalie|sintetize)\b/iu.test(normalized);
  return question.length > 300 || wordCount > 45 || multipleQuestions || analyticalRequest ? "complex" : "simple";
}

export class RouteAnswerUseCase {
  constructor(
    private readonly workflow: PreparedAnswerWorkflow,
    private readonly usage: Pick<UsageMetricsRepository, "record">,
    private readonly options: {
      timeoutMs: number;
      maxOutputTokens: number;
      maxTotalOutputTokens: number;
      maxTotalInputTokens: number;
      maxEstimatedCostUsd: number;
    }
  ) {}

  execute(input: AutoInput): Promise<AnswerQuestionResult> {
    return withTransientBudget({maxSteps:50,maxCalls:16,maxInputTokens:this.options.maxTotalInputTokens,maxOutputTokens:Math.min(64_000,this.options.maxTotalOutputTokens+3_600),maxCostMicros:Math.ceil(this.options.maxEstimatedCostUsd*1_000_000),timeoutMs:this.options.timeoutMs},()=>withExecutionTimeout((signal) => this.run(input, signal), this.options.timeoutMs, input.signal));
  }

  private async run(input: AutoInput, signal: AbortSignal): Promise<AnswerQuestionResult> {
    const deadline = performance.now() + this.options.timeoutMs;
    const question = redactPii(input.question).text;
    const previousQuestions = preparePreviousQuestions(input.previousQuestions);
    const promptVersion = previousQuestions.length ? conversationPromptVersion : groundedPromptVersion;
    const reason = classifyQuestion(question);
    const primary = reason === "simple" ? input.simple : input.complex;
    const attemptedModelIds: string[] = [];
    const emit = async (event: AnswerWorkflowEvent) => {
      signal.throwIfAborted();
      await input.onEvent?.(event);
      signal.throwIfAborted();
    };
    await emit({ type: "retrieving" });
    const prepared = await this.workflow.prepare({
      question, ...(previousQuestions.length ? { previousQuestions } : {}), topK: input.topK, tenantId: input.tenantId, signal
    });
    signal.throwIfAborted();
    if (!prepared) {
      const result = await this.workflow.answerPrepared(null, primary.generator, signal);
      await emit({ type: "validating" });
      return { ...result, model: primary.descriptor, providerModel: primary.model, usage: describeAnswerUsage(result, primary, 0, 0, undefined, promptVersion),
        routing: { mode: "auto", reason, attemptedModelIds, usedFallback: false } };
    }

    const inputUpperBound = reserveGroundedPromptTokens(prepared.question, prepared.context.text, prepared.previousQuestions);
    const planned = this.plan([primary, ...input.fallbacks], inputUpperBound);
    await emit({ type: "generating" });

    for (const [index, model] of planned.entries()) {
      signal.throwIfAborted();
      if (index > 0 && !await input.reserveFallbackQuota(model.descriptor.id)) break;
      const remainingMs = Math.floor(deadline - performance.now());
      if (remainingMs <= 0) break;
      const attemptTimeout = Math.max(1, Math.floor(remainingMs / (planned.length - index)));
      const startedAt = performance.now();
      attemptedModelIds.push(model.descriptor.id);
      let result: AnswerQuestionResult | null = null;
      let providerUsage: ProviderTokenUsage | undefined;
      try {
        result = await withExecutionTimeout((attemptSignal) =>
          this.workflow.answerPrepared(prepared, model.generator, attemptSignal, (usage) => { providerUsage = usage; }), attemptTimeout, signal);
      } catch(error) {
        signal.throwIfAborted();
        if(error instanceof WorkflowGuardError)throw error;
      }
      const usage = describeAnswerUsage(result, model, performance.now() - startedAt, prepared.estimatedInputTokens, providerUsage, promptVersion);
      await this.usage.record({
        tenantId: input.tenantId, actorKey: input.actorKey, operation: "question_auto_routing",
        provider: model.descriptor.provider, model: model.model, cacheHit: false, failed: !result, ...usage
      });
      if (!result) continue;

      await emit({ type: "validating" });
      // No text, citations or winner label are emitted from failed attempts.
      if (!result.refusalReason && result.structuredOutput && result.sources.length > 0) {
        await emit({ type: "citations", sources: result.sources });
        for (const delta of result.answer.match(/[\s\S]{1,256}/gu) ?? []) await emit({ type: "token", delta });
      }
      return { ...result, usage, model: model.descriptor, providerModel: model.model, routing: { mode: "auto", reason, attemptedModelIds, usedFallback: index > 0 } };
    }
    throw new AutoAnswerFailedError();
  }

  private plan(candidates: ComparisonModel[], inputUpperBound: number): ComparisonModel[] {
    const { maxOutputTokens, maxEstimatedCostUsd, maxTotalInputTokens, maxTotalOutputTokens } = this.options;
    const planned: ComparisonModel[] = [];
    const seen = new Set<string>();
    let reservedCost = 0;
    for (const model of candidates) {
      if (seen.has(model.descriptor.id)) continue;
      seen.add(model.descriptor.id);
      const nextCount = planned.length + 1;
      const nextCost = reservedCost + estimateChatCost(model, inputUpperBound, maxOutputTokens);
      if (nextCost > maxEstimatedCostUsd || nextCount * inputUpperBound > maxTotalInputTokens || nextCount * maxOutputTokens > maxTotalOutputTokens) {
        if (planned.length === 0) throw new ChatBudgetExceededError();
        continue;
      }
      planned.push(model);
      reservedCost = nextCost;
    }
    return planned;
  }
}
