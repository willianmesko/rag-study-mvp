import type { Citation } from "../../domain/document.js";
import type { GroundedContext } from "../policies/grounded-answer-policy.js";
import type { AnswerGenerator, ProviderTokenUsage, ProviderUsageObserver } from "./answer-generator.js";
import type { ChatAnswerRouting, ChatAnswerUsage, ChatModelDescriptor } from "@rag-study/contracts";

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
  providerUsage?: ProviderTokenUsage;
  usage?: ChatAnswerUsage;
  model?: ChatModelDescriptor;
  routing?: ChatAnswerRouting;
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
  previousQuestions?: readonly string[];
  topK?: number;
  tenantId?: string;
  queryEmbedding?: number[];
  embeddingIndexVersion?: string;
  maxEstimatedInputTokens?: number;
  signal?: AbortSignal;
};

export interface QuestionAnsweringWorkflow {
  answer(input: AnswerWorkflowInput): Promise<AnswerQuestionResult>;
  answerStream?(input: AnswerWorkflowInput, onEvent: (event: AnswerWorkflowEvent) => void | Promise<void>): Promise<AnswerQuestionResult>;
}

export type PreparedAnswerContext = {
  question: string;
  previousQuestions?: readonly string[];
  context: GroundedContext;
  estimatedInputTokens: number;
};

export interface PreparedAnswerWorkflow {
  prepare(input: AnswerWorkflowInput): Promise<PreparedAnswerContext | null>;
  answerPrepared(prepared: PreparedAnswerContext | null, generator: AnswerGenerator, signal?: AbortSignal, onUsage?: ProviderUsageObserver): Promise<AnswerQuestionResult>;
}

