import { expect, test } from "@playwright/test";
import { transitionChat, type ChatLifecycle } from "../../apps/web/src/features/question-answering/model/chat-lifecycle";
import { transitionAnswer, type AnswerLifecycle, type AnswerTransition } from "../../apps/web/src/features/question-answering/model/answer-lifecycle";

const a = { id: "a", mode: "answer" as const, question: "First question" };
const b = { id: "b", mode: "answer" as const, question: "Second question" };

test("submission and admission are exclusive and correlated across navigation", () => {
  let state: ChatLifecycle = { phase: "idle" };
  state = transitionChat(state, { type: "submit", turn: a });
  expect(transitionChat(state, { type: "submit", turn: b })).toBe(state);
  expect(transitionChat(state, { type: "admit", turn: b })).toBe(state);
  expect(transitionChat(state, { type: "settle", id: b.id })).toBe(state);
  state = transitionChat(state, { type: "detach" });
  state = transitionChat(state, { type: "submit", turn: b });
  expect(transitionChat(state, { type: "settle", id: a.id })).toBe(state);
  state = transitionChat(state, { type: "admit", turn: b });
  expect(state.phase).toBe("running");
  expect(transitionChat(state, { type: "admit", turn: a })).toBe(state);
  state = transitionChat(state, { type: "settle", id: b.id });
  expect(state).toEqual({ phase: "idle" });
});

test("reconnect and cancellation preserve the same draft and ignore stale results", () => {
  let state: AnswerLifecycle = { status: "idle" };
  const send = (event: AnswerTransition) => { state = transitionAnswer(state, event); };
  send({ type: "begin", id: "a", phase: "accepted" });
  send({ type: "token", id: "a", delta: "Hello" });
  send({ type: "progress", id: "a", phase: "reconnecting" });
  expect(state).toMatchObject({ id: "a", draft: "Hello", phase: "reconnecting" });
  send({ type: "cancel", id: "a" });
  send({ type: "progress", id: "a", phase: "validating" });
  expect(state).toMatchObject({ status: "cancelling", draft: "Hello" });
  send({ type: "cancel-unconfirmed", id: "a" });
  expect(state).toMatchObject({ status: "receiving", stopError: true });
  send({ type: "finish", id: "a" });
  for (const event of [ { type: "token", id: "a", delta: "late" }, { type: "progress", id: "a", phase: "reconnecting" }, { type: "cancel", id: "a" } ] satisfies AnswerTransition[])
    expect(transitionAnswer(state, event)).toBe(state);
  send({ type: "begin", id: "b", phase: "accepted" });
  const current = state;
  for (const event of [ { type: "finish", id: "a" }, { type: "token", id: "a", delta: "late" }, { type: "cancel-unconfirmed", id: "a" } ] satisfies AnswerTransition[])
    expect(transitionAnswer(current, event)).toBe(current);
  send({ type: "detach" });
  expect(state).toEqual({ status: "idle" });
});
