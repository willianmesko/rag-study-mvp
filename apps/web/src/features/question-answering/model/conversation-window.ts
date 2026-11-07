import type { ConversationMessages, ConversationTurn } from "@rag-study/contracts";

/** An assembled cache window; the wire page limit still applies to each read. */
export type ConversationWindow = Omit<ConversationMessages, "turns"> & { turns: ConversationTurn[] };
export type MessagePageReader = (before?: number, limit?: number) => Promise<ConversationMessages>;
const maxRefreshPages = 20; // The server admits at most 500 turns, 25 per page.

function checkedPage(page: ConversationMessages, conversationId: string, before?: number) {
  let sequence = 0;
  const ids = new Set<string>();
  if (page.conversation.id !== conversationId) throw new Error("Conversation scope changed.");
  for (const turn of page.turns) {
    if (turn.conversationId !== conversationId || turn.sequence <= sequence || ids.has(turn.runId) || (before !== undefined && turn.sequence >= before)) {
      throw new Error("Conversation page order or scope is invalid.");
    }
    sequence = turn.sequence;
    ids.add(turn.runId);
  }
  if (page.nextBefore !== null && (page.turns.length === 0 || page.nextBefore !== page.turns[0]!.sequence)) {
    throw new Error("Conversation cursor did not advance.");
  }
  return page;
}

function ordered(previous: readonly ConversationTurn[], fresh: readonly ConversationTurn[]) {
  const turns = new Map(previous.map((turn) => [turn.runId, turn]));
  for (const turn of fresh) {
    if (turns.has(turn.runId) && turns.get(turn.runId)!.sequence !== turn.sequence) throw new Error("Conversation identity changed.");
    turns.set(turn.runId, turn);
  }
  const result = [...turns.values()].sort((a, b) => a.sequence - b.sequence);
  if (result.some((turn, i) => i > 0 && turn.sequence === result[i - 1]!.sequence)) throw new Error("Conversation sequence collided.");
  return result;
}

/** Refresh the head, retaining visited history. Only unseen gap pages are read. */
export async function refreshConversationWindow(conversationId: string, previous: ConversationWindow | undefined,
  read: MessagePageReader, signal: AbortSignal): Promise<ConversationWindow> {
  signal.throwIfAborted();
  const head = checkedPage(await read(), conversationId);
  signal.throwIfAborted();
  if (!previous?.turns.length || !head.turns.length) return head;
  if (previous.conversation.id !== conversationId) throw new Error("Conversation scope changed.");
  const newestKnown = previous.turns.at(-1)!.sequence;
  let page = head;
  let fresh = head.turns;
  let pages = 1;
  // The server assigns consecutive turn ordinals. Stop before requesting a
  // page composed entirely of already visited turns at the overlap boundary.
  while (page.nextBefore !== null && page.turns[0]!.sequence > newestKnown + 1) {
    if (++pages > maxRefreshPages) throw new Error("Conversation refresh exceeded its page budget.");
    const cursor = page.nextBefore;
    page = checkedPage(await read(cursor, Math.min(25, cursor - newestKnown - 1)), conversationId, cursor);
    signal.throwIfAborted();
    fresh = [...page.turns, ...fresh];
  }
  return { conversation: head.conversation, turns: ordered(previous.turns, fresh), nextBefore: previous.nextBefore };
}

export function appendOlderMessages(current: ConversationWindow, page: ConversationMessages, before: number): ConversationWindow {
  checkedPage(page, current.conversation.id, before);
  // A second reader must not advance or overwrite a different pagination window.
  if (current.nextBefore !== before) return current;
  return { ...current, turns: ordered(page.turns, current.turns), nextBefore: page.nextBefore };
}
