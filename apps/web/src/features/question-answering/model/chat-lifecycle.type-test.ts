// Compiled by the web strict check; no runtime import or emitted product code.
import type { QuestionResponse, QuestionComparisonResponse } from "@rag-study/contracts";
import type { ConversationTurn, AnswerOutcome, ChatLifecycle } from "./chat-lifecycle";
import type { AnswerLifecycle } from "./answer-lifecycle";

type Reject<T extends false> = T;
type IsAssignable<A, B> = A extends B ? true : false;
type Base = { id: string; question: string };
export type InvalidChatStateChecks = [
  Reject<IsAssignable<Base & { mode: "answer"; status: "pending"; answer: QuestionResponse }, ConversationTurn>>,
  Reject<IsAssignable<Base & { mode: "answer"; status: "completed" }, ConversationTurn>>,
  Reject<IsAssignable<Base & { mode: "answer"; status: "completed"; comparison: QuestionComparisonResponse }, ConversationTurn>>,
  Reject<IsAssignable<Base & { mode: "comparison"; status: "completed"; answer: QuestionResponse }, ConversationTurn>>,
  Reject<IsAssignable<Base & { mode: "answer"; status: "cancelled"; answer: QuestionResponse }, ConversationTurn>>,
  Reject<IsAssignable<Base & { mode: "answer"; status: "pending"; failure: "execution_failed" }, ConversationTurn>>,
  Reject<IsAssignable<{ kind: "completed" }, AnswerOutcome>>,
  Reject<IsAssignable<{ phase: "submitting" }, ChatLifecycle>>,
  Reject<IsAssignable<{ status: "receiving"; phase: "reconnecting"; id: string; draft: string; citations: []; stopError: false }, AnswerLifecycle>>,
];
