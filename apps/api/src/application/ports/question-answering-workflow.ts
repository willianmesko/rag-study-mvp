import type { Citation } from "../../domain/document.js";

export type AnswerQuestionResult = {
  answer: string;
  sources: Citation[];
  citedChunkIds?: string[];
  structuredOutput?: boolean;
  refusalReason?: string;
};

export interface QuestionAnsweringWorkflow {
  answer(input: { question: string; topK?: number; tenantId?: string; queryEmbedding?: number[] }): Promise<AnswerQuestionResult>;
}

