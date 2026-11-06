import { createHash } from "node:crypto";
import type { QuestionAnsweringWorkflow, AnswerQuestionResult } from "../ports/question-answering-workflow.js";
import type { EmbeddingProvider } from "../ports/embedding-provider.js";
import type { SemanticAnswerCache } from "../ports/semantic-answer-cache.js";
import type { UsageMetricsRepository } from "../ports/usage-metrics-repository.js";
import { redactPii } from "../../domain/security/pii-redaction.js";

export class AnswerQuestionUseCase {
  constructor(
    private readonly workflow: QuestionAnsweringWorkflow,
    private readonly embeddings: EmbeddingProvider,
    private readonly cache: SemanticAnswerCache,
    private readonly usage: UsageMetricsRepository,
    private readonly options: { cacheTtlSeconds: number; cacheMinimumSimilarity: number; provider: string; model: string; maxOutputTokens: number; maxEstimatedCostUsd: number; inputCostPer1kUsd: number; outputCostPer1kUsd: number }
  ) {}

  async execute(input: { question: string; topK?: number; tenantId: string; actorKey: string }): Promise<AnswerQuestionResult> {
    const startedAt = Date.now();
    const safeQuestion = redactPii(input.question).text;
    const embedding = await this.embeddings.embed(safeQuestion, "query");
    const cached = await this.cache.findSimilar({ tenantId: input.tenantId, embedding, minimumSimilarity: this.options.cacheMinimumSimilarity });
    if (cached) {
      await this.recordUsage(input, safeQuestion, cached.answer, startedAt, true, false);
      return { answer: cached.answer, sources: redactSources(cached.sources) };
    }
    const estimatedInputTokens = Math.ceil(safeQuestion.length / 4);
    const worstCaseCostUsd = (estimatedInputTokens / 1_000) * this.options.inputCostPer1kUsd
      + (this.options.maxOutputTokens / 1_000) * this.options.outputCostPer1kUsd;
    if (worstCaseCostUsd > this.options.maxEstimatedCostUsd) {
      throw new Error("This request exceeds the configured AI cost budget.");
    }
    try {
      const result = await this.workflow.answer({ question: safeQuestion, topK: input.topK, tenantId: input.tenantId, queryEmbedding: embedding });
      await this.cache.put({ tenantId: input.tenantId, questionHash: createHash("sha256").update(safeQuestion).digest("hex"), embedding, answer: result.answer, sources: redactSources(result.sources), expiresAt: new Date(Date.now() + this.options.cacheTtlSeconds * 1_000) });
      await this.recordUsage(input, safeQuestion, result.answer, startedAt, false, false);
      return result;
    } catch (error) {
      await this.recordUsage(input, safeQuestion, "", startedAt, false, true);
      throw error;
    }
  }

  private async recordUsage(input: { tenantId: string; actorKey: string }, question: string, answer: string, startedAt: number, cacheHit: boolean, failed: boolean): Promise<void> {
    const inputTokens = Math.ceil(question.length / 4);
    const outputTokens = Math.ceil(answer.length / 4);
    const estimatedCostUsd = cacheHit ? 0 : (inputTokens / 1_000) * this.options.inputCostPer1kUsd + (outputTokens / 1_000) * this.options.outputCostPer1kUsd;
    await this.usage.record({ tenantId: input.tenantId, actorKey: input.actorKey, operation: "question_answering", provider: this.options.provider, model: this.options.model, cacheHit, inputTokens, outputTokens, latencyMs: Date.now() - startedAt, estimatedCostUsd, failed });
  }
}

function redactSources(sources: AnswerQuestionResult["sources"]): AnswerQuestionResult["sources"] {
  return sources.map((source) => ({ ...source, content: redactPii(source.content).text }));
}

