import type { PromptInjectionAssessment } from "./security/prompt-injection.js";

export type DocumentInput = {
  tenantId: string;
  source: string;
  title?: string;
  text: string;
  metadata?: Record<string, unknown>;
};

export type TextChunk = {
  ordinal: number;
  content: string;
};

export type EmbeddedChunk = TextChunk & {
  embedding: number[];
  security: PromptInjectionAssessment;
};

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  ordinal: number;
  content: string;
  source: string;
  title: string | null;
  score: number;
  security: PromptInjectionAssessment;
  retrieval?: {
    vectorRank: number | null;
    keywordRank: number | null;
    fusionScore: number;
  };
  reranker?: {
    rank: number;
    score: number;
  };
};

// A citation carries the exact retrieved chunk shown to the answer generator.
// This lets the UI make sources inspectable without performing a second search.
export type Citation = Pick<RetrievedChunk, "chunkId" | "documentId" | "source" | "title" | "ordinal" | "score" | "content">;

