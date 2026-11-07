import type { Citation } from "../../domain/document.js";

export type AnswerQuestionResult = {
  answer: string;
  sources: Citation[];
  contextSources?: Citation[];
  citedChunkIds?: string[];
  cacheHit?: boolean;
  structuredOutput?: boolean;
  refusalReason?: string;
};

export type AnswerWorkflowEvent =
  | { type: "retrieving" }
  | { type: "generating" }
  | { type: "validating" }
  | { type: "citations"; sources: Citation[] }
  | { type: "token"; delta: string }
  | { type: "cached" };

export type AnswerWorkflowInput = {
  question: string;
  topK?: number;
  tenantId?: string;
  queryEmbedding?: number[];
  signal?: AbortSignal;
};

export interface QuestionAnsweringWorkflow {
  answer(input: AnswerWorkflowInput): Promise<AnswerQuestionResult>;
  answerStream?(input: AnswerWorkflowInput, onEvent: (event: AnswerWorkflowEvent) => void | Promise<void>): Promise<AnswerQuestionResult>;
}

