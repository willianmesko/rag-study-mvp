import type { EmbeddedChunk, RetrievedChunk } from "../../domain/document.js";
import type { DocumentFilters } from "@rag-study/contracts";

export type HybridSearchInput = {
  tenantId: string;
  embedding: number[];
  embeddingIndexVersion?: string;
  query: string;
  lexicalQuery: string;
  limit: number;
  vectorCandidateLimit: number;
  keywordCandidateLimit: number;
  reciprocalRankConstant: number;
};

export type ManagedDocument = {
  id: string;
  source: string;
  title: string | null;
  chunkCount: number;
  hasOriginal: boolean;
  format?: string;
  language?: string;
  sectionCount?: number;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredChunk = {
  id: string;
  ordinal: number;
  content: string;
  security: RetrievedChunk["security"];
  createdAt: Date;
};

export interface DocumentRepository {
  replace(
    document: { tenantId: string; source: string; title?: string; metadata: Record<string, unknown>; embeddingIndexVersion?: string },
    chunks: EmbeddedChunk[]
  ): Promise<{ id: string; chunkCount: number }>;
  findHybrid(input: HybridSearchInput): Promise<RetrievedChunk[]>;
  list(tenantId: string, limit: number, filters?: DocumentFilters): Promise<ManagedDocument[]>;
  listChunks(input: { tenantId: string; documentId: string; limit: number }): Promise<StoredChunk[]>;
  delete(input: { tenantId: string; documentId: string }): Promise<boolean>;
}

