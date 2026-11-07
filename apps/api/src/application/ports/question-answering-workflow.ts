import type { Citation } from "../../domain/document.js";
import type { GroundedContext } from "../policies/grounded-answer-policy.js";
import type { AnswerGenerator } from "./answer-generator.js";

export type AnswerQuestionResult = {
  answer: string;
  sources: Citation[];
  contextSources?: Citation[];
  citedChunkIds?: string[];
  cacheHit?: boolean;
  structuredOutput?: boolean;
  refusalReason?: string;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
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
  maxEstimatedInputTokens?: number;
  signal?: AbortSignal;
};

export interface QuestionAnsweringWorkflow {
  answer(input: AnswerWorkflowInput): Promise<AnswerQuestionResult>;
  answerStream?(input: AnswerWorkflowInput, onEvent: (event: AnswerWorkflowEvent) => void | Promise<void>): Promise<AnswerQuestionResult>;
}

export type PreparedAnswerContext = {
  question: string;
  context: GroundedContext;
  estimatedInputTokens: number;
};

export interface PreparedAnswerWorkflow {
  prepare(input: AnswerWorkflowInput): Promise<PreparedAnswerContext | null>;
  answerPrepared(prepared: PreparedAnswerContext | null, generator: AnswerGenerator, signal?: AbortSignal): Promise<AnswerQuestionResult>;
}

