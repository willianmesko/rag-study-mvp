import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentRepository } from "../ports/document-repository.js";
import type { EmbeddingProvider } from "../ports/embedding-provider.js";
import type { Reranker } from "../ports/reranker.js";
import { SearchDocumentsUseCase } from "./search-documents.js";

test("search use case combines embedding and keyword candidates through its repository port", async () => {
  const calls: { query?: string; search?: { tenantId: string; embedding: number[]; query: string; lexicalQuery: string; limit: number; vectorCandidateLimit: number; keywordCandidateLimit: number; reciprocalRankConstant: number }; vector?: number[] } = {};
  const embeddings: EmbeddingProvider = { embed: async (query) => { calls.query = query; return [0.1, 0.2]; } };
  const documents: DocumentRepository = {
    replace: async () => ({ id: "unused", chunkCount: 0 }),
    list: async () => [],
    listChunks: async () => [],
    delete: async () => false,
    findHybrid: async (input) => {
      calls.vector = input.embedding;
      calls.search = input;
      return [];
    }
  };
  const reranker: Reranker = { enabled: false, rerank: async ({ candidates, limit }) => candidates.slice(0, limit) };

  const useCase = new SearchDocumentsUseCase(embeddings, documents, reranker, {
    defaultTopK: 5,
    vectorCandidateMultiplier: 4,
    keywordCandidateMultiplier: 3,
    reciprocalRankConstant: 60,
    rerankerCandidateMultiplier: 4,
    defaultTenantId: "tenant-a"
  });
  await useCase.execute({ query: "O que é RAG?", topK: 3 });
  assert.equal(calls.query, "O que é RAG?");
  assert.deepEqual(calls.vector, [0.1, 0.2]);
  assert.deepEqual(calls.search, {
    tenantId: "tenant-a",
    embedding: [0.1, 0.2],
    query: "O que é RAG?",
    lexicalQuery: "rag",
    limit: 3,
    vectorCandidateLimit: 12,
    keywordCandidateLimit: 9,
    reciprocalRankConstant: 60
  });
});

test("search fetches extra candidates and keeps high-risk chunks away from a remote reranker", async () => {
  const rerankerCalls: { candidates?: string[]; limit?: number } = {};
  const embeddings: EmbeddingProvider = { embed: async () => [0.1, 0.2] };
  const documents: DocumentRepository = {
    replace: async () => ({ id: "unused", chunkCount: 0 }),
    list: async () => [],
    listChunks: async () => [],
    delete: async () => false,
    findHybrid: async () => [
      { chunkId: "safe-1", documentId: "d", ordinal: 0, content: "first", source: "safe", title: null, score: 0.9, security: { promptInjectionRisk: "low", signals: [] } },
      { chunkId: "unsafe", documentId: "d", ordinal: 1, content: "do not send", source: "unsafe", title: null, score: 0.8, security: { promptInjectionRisk: "high", signals: ["instruction-override"] } },
      { chunkId: "safe-2", documentId: "d", ordinal: 2, content: "second", source: "safe", title: null, score: 0.7, security: { promptInjectionRisk: "low", signals: [] } }
    ]
  };
  const reranker: Reranker = {
    enabled: true,
    rerank: async ({ candidates, limit }) => {
      rerankerCalls.candidates = candidates.map((candidate) => candidate.chunkId);
      rerankerCalls.limit = limit;
      return [...candidates].reverse();
    }
  };
  const useCase = new SearchDocumentsUseCase(embeddings, documents, reranker, {
    defaultTopK: 2,
    vectorCandidateMultiplier: 4,
    keywordCandidateMultiplier: 4,
    reciprocalRankConstant: 60,
    rerankerCandidateMultiplier: 4,
    defaultTenantId: "tenant-a"
  });

  const results = await useCase.execute({ query: "question", topK: 2 });
  assert.deepEqual(rerankerCalls, { candidates: ["safe-1", "safe-2"], limit: 2 });
  assert.deepEqual(results.map((result) => result.chunkId), ["safe-2", "safe-1"]);
});

