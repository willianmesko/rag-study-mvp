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

export type Citation = Pick<RetrievedChunk, "source" | "title" | "ordinal" | "score">;

