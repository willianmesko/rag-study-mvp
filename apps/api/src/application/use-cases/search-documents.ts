import type { RetrievedChunk } from "../../domain/document.js";
import { isSafeForAnswer } from "../../domain/security/prompt-injection.js";
import { toLexicalQuery } from "../policies/lexical-query.js";
import type { DocumentRepository } from "../ports/document-repository.js";
import type { EmbeddingProvider } from "../ports/embedding-provider.js";
import type { Reranker } from "../ports/reranker.js";

export class SearchDocumentsUseCase {
  constructor(
    private readonly embeddings: EmbeddingProvider,
    private readonly documents: DocumentRepository,
    private readonly reranker: Reranker,
    private readonly options: {
      defaultTopK: number;
      vectorCandidateMultiplier: number;
      keywordCandidateMultiplier: number;
      reciprocalRankConstant: number;
      rerankerCandidateMultiplier: number;
      defaultTenantId: string;
    }
  ) {}

  async execute(input: { query: string; topK?: number; tenantId?: string; queryEmbedding?: number[]; signal?: AbortSignal }): Promise<RetrievedChunk[]> {
    input.signal?.throwIfAborted();
    const queryEmbedding = input.queryEmbedding ?? await this.embeddings.embed(input.query, "query", input.signal);
    input.signal?.throwIfAborted();
    const limit = input.topK ?? this.options.defaultTopK;
    const rerankCandidateLimit = this.reranker.enabled
      ? limit * this.options.rerankerCandidateMultiplier
      : limit;
    const candidates = await this.documents.findHybrid({
      tenantId: input.tenantId ?? this.options.defaultTenantId,
      embedding: queryEmbedding,
      query: input.query,
      lexicalQuery: toLexicalQuery(input.query),
      limit: rerankCandidateLimit,
      vectorCandidateLimit: rerankCandidateLimit * this.options.vectorCandidateMultiplier,
      keywordCandidateLimit: rerankCandidateLimit * this.options.keywordCandidateMultiplier,
      reciprocalRankConstant: this.options.reciprocalRankConstant
    });

    input.signal?.throwIfAborted();
    if (!this.reranker.enabled) return candidates.slice(0, limit);

    // High-risk chunks remain inspectable through search, but never leave this
    // process to a remote reranker and never reach the answer-generation model.
    const safeCandidates = candidates.filter((candidate) => isSafeForAnswer(candidate.security));
    const highRiskCandidates = candidates.filter((candidate) => !isSafeForAnswer(candidate.security));
    const reranked = await this.reranker.rerank({ query: input.query, candidates: safeCandidates, limit, signal: input.signal });
    input.signal?.throwIfAborted();
    return [...reranked, ...highRiskCandidates].slice(0, limit);
  }
}

