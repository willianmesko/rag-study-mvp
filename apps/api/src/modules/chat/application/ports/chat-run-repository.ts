import type { ChatRunEvent } from "@rag-study/contracts";

export type ChatRunScope = { tenantId: string; actorId: string; runId: string; conversationId?: string };
export type ChatRunStatus = "running" | "completed" | "failed" | "cancelled";
export type StoredChatRunEvent = { id: number; event: ChatRunEvent };
export type ChatRunSnapshot = { status: ChatRunStatus; events: StoredChatRunEvent[] };

export interface ChatRunRepository {
  /** Creates the run and its accepted event atomically. Only the creator may execute it. */
  create(scope: ChatRunScope, executionTimeoutMs: number): Promise<boolean>;
  /** A terminal event and its state transition commit together. */
  append(scope: ChatRunScope, events: ChatRunEvent[], status?: "completed" | "failed"): Promise<boolean>;
  cancel(scope: ChatRunScope): Promise<ChatRunStatus | null>;
  get(scope: ChatRunScope): Promise<ChatRunStatus | null>;
  /** Returns a bounded page. Drain pages until empty even when status is terminal. */
  read(scope: ChatRunScope, after: number): Promise<ChatRunSnapshot | null>;
  pruneExpired(): Promise<number>;
}
