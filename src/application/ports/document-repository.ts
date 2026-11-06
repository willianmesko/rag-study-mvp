import type { EmbeddedChunk, RetrievedChunk } from "../../domain/document.js";

export type HybridSearchInput = {
  tenantId: string;
  embedding: number[];
  query: string;
  lexicalQuery: string;
  limit: number;
  vectorCandidateLimit: number;
  keywordCandidateLimit: number;
  reciprocalRankConstant: number;
};

export interface DocumentRepository {
  replace(
    document: { tenantId: string; source: string; title?: string; metadata: Record<string, unknown> },
    chunks: EmbeddedChunk[]
  ): Promise<{ id: string; chunkCount: number }>;
  findHybrid(input: HybridSearchInput): Promise<RetrievedChunk[]>;
}

