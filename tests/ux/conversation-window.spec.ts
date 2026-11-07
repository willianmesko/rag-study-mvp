import { expect, test } from "@playwright/test";
import type { ConversationMessages, ConversationTurn } from "@rag-study/contracts";
import { appendOlderMessages, refreshConversationWindow } from "../../apps/web/src/features/question-answering/model/conversation-window";

const date = "2026-11-07T12:00:00.000Z";
function turn(sequence: number): ConversationTurn {
  return { runId: `run-${sequence}`, userMessageId: `user-${sequence}`, assistantMessageId: `assistant-${sequence}`,
    conversationId: "conversation", sequence, question: `Question ${sequence}`, mode: "answer", status: "completed",
    input: { question: `Question ${sequence}` }, answer: { answer: `Answer ${sequence}`, sources: [] }, comparison: null,
    feedback: null, failureCode: null, createdAt: date, completedAt: date };
}
function page(total: number, before = total + 1, limit = 25): ConversationMessages {
  const turns = Array.from({ length: total }, (_, i) => turn(i + 1)).filter((t) => t.sequence < before);
  const visible = turns.slice(-limit);
  return { conversation: { id: "conversation", title: "Study", turnCount: total, createdAt: date, updatedAt: date, expiresAt: date },
    turns: visible, nextBefore: turns.length > limit ? visible[0].sequence : null };
}

test("refreshing the head preserves 75 visited turns and the old-page cursor", async () => {
  const current = page(75, 76, 75), calls: unknown[] = [];
  current.turns[29].feedback = "up";
  const result = await refreshConversationWindow("conversation", current, async (...args) => {
    calls.push(args); return page(76);
  }, new AbortController().signal);
  expect(calls).toEqual([[]]);
  expect(result.turns.map((t) => t.sequence)).toEqual(Array.from({ length: 76 }, (_, i) => i + 1));
  expect(result.turns[29]).toBe(current.turns[29]);
  expect(result.turns[29].feedback).toBe("up");
  expect(result.nextBefore).toBeNull();
  const partial = page(75, 76, 50);
  const refreshed = await refreshConversationWindow("conversation", partial, async () => page(76), new AbortController().signal);
  expect(refreshed.nextBefore).toBe(26);
  expect(appendOlderMessages(refreshed, page(76, 26), 26).turns).toHaveLength(76);
});

test("a burst fetches only missing turns, without refetching visited pages", async () => {
  const calls: Array<[number | undefined, number | undefined]> = [];
  const current = page(75, 76, 75);
  const result = await refreshConversationWindow("conversation", current, async (before, limit) => {
    calls.push([before, limit]); return page(105, before, limit);
  }, new AbortController().signal);
  expect(calls).toEqual([[undefined, undefined], [81, 5]]);
  expect(result.turns.map((t) => t.sequence)).toEqual(Array.from({ length: 105 }, (_, i) => i + 1));
  expect(result.nextBefore).toBeNull();
});

test("older-page merging retains newer results and ignores an already advanced cursor", () => {
  const current = page(76, 77, 50);
  const older = page(76, current.nextBefore!);
  const updated = appendOlderMessages(current, older, current.nextBefore!);
  expect(updated.turns.at(-1)?.sequence).toBe(76);
  expect(updated.turns[0].sequence).toBe(2);
  expect(appendOlderMessages(updated, older, current.nextBefore!)).toBe(updated);
});

test("cross-conversation, malformed and colliding pages fail before replacing cached history", async () => {
  for (const invalid of [
    { ...page(76), conversation: { ...page(76).conversation, id: "another" } },
    { ...page(76), nextBefore: 900 },
    { ...page(76), turns: [...page(76).turns].reverse() },
    { ...page(76), turns: page(76).turns.map((t) => ({ ...t, conversationId: "another" })) },
  ]) {
    await expect(refreshConversationWindow("conversation", page(75, 76, 75), async () => invalid, new AbortController().signal)).rejects.toThrow();
  }
  const collision = page(76);
  collision.turns[0] = { ...collision.turns[0], runId: "replacement" };
  await expect(refreshConversationWindow("conversation", page(75, 76, 75), async () => collision, new AbortController().signal)).rejects.toThrow(/collided/);
});

test("cancellation and the page budget stop gap reads without returning partial state", async () => {
  const controller = new AbortController();
  let reads = 0;
  await expect(refreshConversationWindow("conversation", page(1), async (before, limit) => {
    reads++; if (reads === 2) controller.abort(new Error("Fixture detached"));
    return page(105, before, limit);
  }, controller.signal)).rejects.toThrow(/detached/);
  expect(reads).toBe(2);
  let bounded = 0;
  await expect(refreshConversationWindow("conversation", page(1), async (before, limit) => {
    bounded++; return page(1000, before, limit);
  }, new AbortController().signal)).rejects.toThrow(/page budget/);
  expect(bounded).toBe(20);
});
