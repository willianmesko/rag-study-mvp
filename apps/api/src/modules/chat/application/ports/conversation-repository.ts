import type {
  ConversationSummary,
  ConversationMessages,
  ConversationTurn,
  QuestionInput,
  QuestionComparisonInput,
  QuestionComparisonResponse,
} from "@rag-study/contracts";

export type ConversationOwner = { tenantId: string; userId: string };
export type ConversationScope = ConversationOwner & { conversationId: string };
export type ConversationSubmission = ConversationScope & {
  runId: string;
  mode: "answer" | "comparison";
  input: QuestionInput | QuestionComparisonInput;
};
/** Recovery reads persisted JSON; its mode/input are not trusted until decoded. */
export type PendingConversationSubmission = ConversationScope & { runId: string; mode: unknown; input: unknown };
export class ConversationError extends Error {
  constructor(
    readonly code:
      | "conversation_unavailable"
      | "conversation_busy"
      | "idempotency_conflict"
      | "conversation_limit"
      | "message_limit"
      | "feedback_unavailable",
    readonly status: number,
  ) {
    super(
      {
        conversation_unavailable: "This conversation is no longer available.",
        conversation_busy:
          "An answer is already being prepared in this conversation.",
        idempotency_conflict:
          "This message ID was already used for another submission.",
        conversation_limit:
          "Conversation limit reached. Delete an older conversation to continue.",
        message_limit: "This conversation is full. Start a new conversation.",
        feedback_unavailable: "Only a completed assistant reply can be rated.",
      }[code],
    );
    this.name = "ConversationError";
  }
}
export interface ConversationRepository {
  create(
    owner: ConversationOwner,
    id: string,
    title?: string,
  ): Promise<ConversationSummary>;
  list(
    owner: ConversationOwner,
    limit: number,
    cursor?: string,
  ): Promise<{
    conversations: ConversationSummary[];
    nextCursor: string | null;
  }>;
  messages(
    scope: ConversationScope,
    limit: number,
    before?: number,
  ): Promise<ConversationMessages>;
  rename(scope: ConversationScope, title: string): Promise<ConversationSummary>;
  delete(scope: ConversationScope): Promise<void>;
  deleteAll(owner: ConversationOwner): Promise<void>;
  feedback(
    scope: ConversationScope,
    assistantMessageId: string,
    value: "up" | "down" | null,
  ): Promise<void>;
  admit(input: ConversationSubmission): Promise<ConversationTurn>;
  pending(limit: number): Promise<PendingConversationSubmission[]>;
  turn(
    scope: ConversationScope,
    runId: string,
  ): Promise<ConversationTurn | null>;
  fail(scope: ConversationScope, runId: string): Promise<void>;
  claimComparison(
    scope: ConversationScope,
    runId: string,
    timeoutMs: number,
  ): Promise<boolean>;
  completeComparison(
    scope: ConversationScope,
    runId: string,
    response: QuestionComparisonResponse,
  ): Promise<boolean>;
  cancelPending(scope: ConversationScope, runId: string): Promise<void>;
  pruneExpired(): Promise<number>;
}
