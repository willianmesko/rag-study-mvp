import { createHash } from "node:crypto";
import type { AnswerWorkflowEvent, QuestionAnsweringWorkflow, AnswerQuestionResult } from "../ports/question-answering-workflow.js";
import { resolveWorkspaceEmbeddingIndex, type EmbeddingProvider } from "../ports/embedding-provider.js";
import type { SemanticAnswerCache } from "../ports/semantic-answer-cache.js";
import type { UsageMetricsRepository } from "../ports/usage-metrics-repository.js";
import { invalidCitationsAnswer } from "../policies/structured-answer.js";
import { ChatBudgetExceededError, estimateChatCost, type ChatPricing } from "../policies/chat-cost.js";
import { conversationPromptVersion, groundedPromptVersion } from "../policies/grounded-answer-policy.js";
import { createConversationQuery, preparePreviousQuestions } from "../policies/conversation-context.js";
import { describeAnswerUsage } from "../policies/answer-usage.js";
import { redactPii } from "../../domain/security/pii-redaction.js";

export class AnswerQuestionUseCase {
  constructor(
    private readonly workflow: QuestionAnsweringWorkflow,
    private readonly embeddings: EmbeddingProvider,
    private readonly cache: SemanticAnswerCache,
    private readonly usage: UsageMetricsRepository,
    private readonly options: ChatPricing & { cacheTtlSeconds: number; cacheMinimumSimilarity: number; cacheVariant?: string; provider: string; model: string; maxOutputTokens: number; maxEstimatedCostUsd: number }
  ) {}

  async execute(input: { question: string; previousQuestions?: readonly string[]; topK?: number; tenantId: string; actorKey: string; signal?: AbortSignal; onEvent?: (event: AnswerWorkflowEvent) => void | Promise<void> }): Promise<AnswerQuestionResult> {
    const { signal } = input;
    signal?.throwIfAborted();
    const startedAt = Date.now();
    const safeQuestion = redactPii(input.question).text;
    const previousQuestions = preparePreviousQuestions(input.previousQuestions);
    const hasContext = previousQuestions.length > 0;
    const query = createConversationQuery(safeQuestion, previousQuestions);
    const promptVersion = hasContext ? conversationPromptVersion : groundedPromptVersion;
    const embeddingIndex = await resolveWorkspaceEmbeddingIndex(this.embeddings, input.tenantId, signal);
    const modelKey = JSON.stringify([this.options.provider, this.options.model, groundedPromptVersion, this.options.cacheVariant, input.topK, embeddingIndex.version]);
    const embedding = await embeddingIndex.provider.embed(query, "query", signal);
    signal?.throwIfAborted();
    // Similar wording can refer to different entities in different conversations.
    const cached = hasContext ? null : await this.cache.findSimilar({ tenantId: input.tenantId, modelKey, embedding, embeddingIndexVersion: embeddingIndex.version, minimumSimilarity: this.options.cacheMinimumSimilarity });
    signal?.throwIfAborted();
    if (cached && cached.sources.length > 0 && cached.answer !== invalidCitationsAnswer) {
      const answer = redactPii(cached.answer).text;
      await input.onEvent?.({ type: "cached" });
      signal?.throwIfAborted();
      await input.onEvent?.({ type: "validating" });
      signal?.throwIfAborted();
      const result = { answer, sources: redactSources(cached.sources), contextSources: [], cacheHit: true };
      const usage = await this.recordUsage(input, query, startedAt, result, promptVersion);
      return { ...result, usage };
    }
    const outputBudget = estimateChatCost(this.options, 0, this.options.maxOutputTokens);
    if (outputBudget > this.options.maxEstimatedCostUsd) throw new ChatBudgetExceededError();
    const maxEstimatedInputTokens = this.options.inputCostPer1kUsd > 0
      ? Math.floor((this.options.maxEstimatedCostUsd - outputBudget) * 1_000 / this.options.inputCostPer1kUsd)
      : undefined;
    try {
      const workflowInput = {
        question: safeQuestion, ...(hasContext ? { previousQuestions } : {}), topK: input.topK, tenantId: input.tenantId,
        queryEmbedding: embedding, embeddingIndexVersion: embeddingIndex.version, signal, maxEstimatedInputTokens
      };
      const result = this.workflow.answerStream
        ? await this.workflow.answerStream(workflowInput, input.onEvent ?? (() => undefined))
        : await this.workflow.answer(workflowInput);
      signal?.throwIfAborted();
      const answer = redactPii(result.answer).text;
      if (!hasContext && !result.refusalReason && result.sources.length > 0) {
        const questionHash = createHash("sha256").update(safeQuestion).digest("hex");
        await this.cache.put({ tenantId: input.tenantId, modelKey, questionHash, embedding, embeddingIndexVersion: embeddingIndex.version,
          answer, sources: redactSources(result.sources), expiresAt: new Date(Date.now() + this.options.cacheTtlSeconds * 1_000) });
      }
      const usage = await this.recordUsage(input, query, startedAt, { ...result, answer }, promptVersion);
      return { ...result, answer, usage };
    } catch (error) {
      if (!(error instanceof ChatBudgetExceededError)) await this.recordUsage(input, query, startedAt, null, promptVersion);
      throw error;
    }
  }

  private async recordUsage(input: { tenantId: string; actorKey: string }, query: string, startedAt: number, result: AnswerQuestionResult | null, promptVersion: string) {
    const usage = describeAnswerUsage(result, this.options, Date.now() - startedAt, Math.ceil(query.length / 4), result?.providerUsage, promptVersion);
    await this.usage.record({
      tenantId: input.tenantId, actorKey: input.actorKey, operation: "question_answering",
      provider: this.options.provider, model: this.options.model, cacheHit: result?.cacheHit === true, failed: !result, ...usage
    });
    return usage;
  }
}

function redactSources(sources: AnswerQuestionResult["sources"]): AnswerQuestionResult["sources"] {
  return sources.map((source) => ({ ...source, content: redactPii(source.content).text }));
}

