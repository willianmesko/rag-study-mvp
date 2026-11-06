import type { Citation } from "../../domain/document.js";

export type AnswerQuestionResult = {
  answer: string;
  sources: Citation[];
  citedChunkIds?: string[];
  structuredOutput?: boolean;
  refusalReason?: string;
};

export type AnswerWorkflowEvent =
  | { type: "retrieving" }
  | { type: "generating" }
  | { type: "validating" }
  | { type: "token"; delta: string }
  | { type: "cached" };

export interface QuestionAnsweringWorkflow {
  answer(input: { question: string; topK?: number; tenantId?: string; queryEmbedding?: number[] }): Promise<AnswerQuestionResult>;
  answerStream?(input: { question: string; topK?: number; tenantId?: string; queryEmbedding?: number[] }, onEvent: (event: AnswerWorkflowEvent) => void | Promise<void>): Promise<AnswerQuestionResult>;
}

