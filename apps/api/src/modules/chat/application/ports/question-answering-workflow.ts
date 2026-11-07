import type { Citation } from "../../../knowledge/index.js";
import type { GroundedContext } from "../../../ai/index.js";
import type { AnswerGenerator, ProviderTokenUsage, ProviderUsageObserver } from "../../../ai/index.js";
import type { ChatAnswerRouting, ChatAnswerUsage, ChatModelDescriptor } from "@rag-study/contracts";
import type { ClaimVerification } from "../../../ai/index.js";

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
  providerModel?: string;
  routing?: ChatAnswerRouting;
  claimVerification?:ClaimVerification;
  repaired?:boolean;
  retrievalAttempts?:number;
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
  maxEstimatedInputTokens?:number;
  retrievalAttempts?:number;
};

export interface PreparedAnswerWorkflow {
  prepare(input: AnswerWorkflowInput): Promise<PreparedAnswerContext | null>;
  answerPrepared(prepared: PreparedAnswerContext | null, generator: AnswerGenerator, signal?: AbortSignal, onUsage?: ProviderUsageObserver): Promise<AnswerQuestionResult>;
}

