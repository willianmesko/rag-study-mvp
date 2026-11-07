import type { AnswerGenerator, ClaimVerifier } from "../../../ai/index.js";
import type { RetrievedChunk } from "../../../knowledge/index.js";
import type {
  PreparedAnswerWorkflow,
  QuestionAnsweringWorkflow,
} from "./question-answering-workflow.js";

export interface QuestionRetriever {
  execute(input: {
    query: string;
    lexicalQuestion?: string;
    topK?: number;
    tenantId?: string;
    queryEmbedding?: number[];
    embeddingIndexVersion?: string;
    signal?: AbortSignal;
  }): Promise<RetrievedChunk[]>;
}

export type AnswerWorkflowOptions = {
  maxContextChars: number;
  minimumScore: number;
  maxSteps?: number;
  timeoutMs?: number;
  requireStructuredOutput?: boolean;
  claimVerifier?: ClaimVerifier;
  claimVerifierFor?: (generator: AnswerGenerator) => ClaimVerifier;
  workflowId?: string;
};

export type GroundedQuestionWorkflow = QuestionAnsweringWorkflow & PreparedAnswerWorkflow;

/** An execution implementation may be graph-based or ordinary application code. */
export type QuestionAnsweringWorkflowFactory = (
  retriever: QuestionRetriever,
  generator: AnswerGenerator,
  options: AnswerWorkflowOptions,
) => GroundedQuestionWorkflow;

/** Instrumentation decorates a capability without exposing tracing SDK types. */
export type QuestionAnsweringWorkflowDecorator = (
  workflow: QuestionAnsweringWorkflow,
) => QuestionAnsweringWorkflow;
