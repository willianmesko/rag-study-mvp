import { useEffect, useRef, useState } from "react";
import {
  MAX_PREVIOUS_CHAT_QUESTION_LENGTH,
  MAX_PREVIOUS_CHAT_QUESTIONS,
  type QuestionComparisonInput,
  type QuestionInput,
  type QuestionResponse,
} from "@rag-study/contracts";
import { useLiveAnswer, type AnswerOutcome } from "./use-live-answer";
import {
  useModelComparison,
  type ComparisonOutcome,
} from "./use-model-comparison";
import { useSavedConversations } from "./use-saved-conversations";

import { transitionChat, type ActiveTurn, type ChatLifecycle, type ChatTransition, type ConversationTurn, type TurnResult } from "./chat-lifecycle";
export type { ConversationTurn } from "./chat-lifecycle";

export function useConversation({
  accessToken,
  workspaceId,
  scope,
  onAnswered,
  navigation = true,
  observed = true,
  messagesObserved = true,
}: {
  accessToken?: string | null;
  workspaceId?: string;
  scope: string;
  onAnswered: (input: { question: string; response: QuestionResponse }) => void;
  navigation?: boolean;
  observed?: boolean;
  messagesObserved?: boolean;
}) {
  const [readerOwned, setReaderOwned] = useState(false);
  const saved = useSavedConversations({
    token: accessToken,
    workspaceId,
    scope,
    navigation, observed, messagesObserved, readerOwned,
  });
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [lifecycle, setLifecycle] = useState<ChatLifecycle>({ phase: "idle" });
  const current = useRef(lifecycle);
  function readLifecycle(): ChatLifecycle { return current.current; }
  function transition(event: ChatTransition) {
    const next = transitionChat(current.current, event);
    if (next === current.current) return;
    current.current = next;
    setLifecycle(next);
  }
  useEffect(() => () => { current.current = { phase: "idle" }; }, [scope]);

  function addTurn(turn: ActiveTurn) {
    transition({ type: "admit", turn });
    if (current.current.phase !== "running" || current.current.turn.id !== turn.id) return;
    setTurns((turns) => turns.some((item) => item.id === turn.id) ? turns : [...turns, { ...turn, status: "pending" }]);
  }

  function finishTurn(id: string, mode: ActiveTurn["mode"], result: TurnResult) {
    const state = current.current;
    if (state.phase !== "running" || state.turn.id !== id || state.turn.mode !== mode) return;
    const turn = state.turn;
    transition({ type: "settle", id });
    setTurns((turns) => turns.map((item): ConversationTurn => {
      if (item.id !== id) return item;
      const base = { id: item.id, question: item.question };
      return result.status === "completed" ? { ...base, ...result } : { ...base, mode: item.mode, ...result };
    }));
    if (!saved.enabled && turn.question && result.status === "completed" && result.mode === "answer" && !result.answer.refusalReason)
      onAnswered({ question: turn.question, response: result.answer });
    if (saved.enabled) saved.refresh();
  }

  function finishAnswer(id: string, result: AnswerOutcome) {
    finishTurn(id, "answer", result.kind === "completed" ? { mode: "answer", answer: result.answer, status: "completed" }
      : result.kind === "cancelled" ? { status: "cancelled" } : { status: "failed", failure: result.failure, error: result.error });
  }

  function finishComparison(id: string, result: ComparisonOutcome) {
    finishTurn(id, "comparison", result.kind === "completed" ? { mode: "comparison", comparison: result.data, status: "completed" }
      : result.kind === "cancelled" ? { status: "cancelled" } : { status: "failed", error: result.error });
  }

  const live = useLiveAnswer({
    accessToken,
    workspaceId,
    scope,
    onFinished: finishAnswer,
    onReadingChange: setReaderOwned,
    autoRecover: !accessToken || (!saved.enabled && !saved.initializing),
    onRecovered: (id) => {
      if (current.current.phase === "idle") addTurn({ id, mode: "answer", question: null });
    },
  });
  const comparison = useModelComparison(finishComparison, setReaderOwned);

  const previousSelection = useRef(saved.selectedId);
  useEffect(() => {
    if (previousSelection.current === saved.selectedId) return;
    previousSelection.current = saved.selectedId;
    if (current.current.phase === "idle" || current.current.turn.conversationId !== saved.selectedId) {
      transition({ type: "detach" });
      setTurns([]);
      live.detach();
      comparison.detach();
    }
  }, [saved.selectedId]);
  useEffect(() => {
    if (!saved.enabled || !messagesObserved) return;
    const pending = saved.turns.find(
      (turn) => (turn.status === "queued" || turn.status === "running") && !turns.some((local) => local.id === turn.runId && local.status !== "pending"),
    );
    if (pending && current.current.phase === "idle") {
      addTurn({
        id: pending.runId,
        mode: pending.mode,
        question: pending.question,
        conversationId: pending.conversationId,
      });
      if (pending.mode === "answer")
        live.recoverSaved(
          pending.runId,
          pending.input as QuestionInput,
          pending.conversationId,
        );
      else
        comparison.recover(
          pending.input as QuestionComparisonInput,
          accessToken!,
          workspaceId!,
          { conversationId: pending.conversationId, runId: pending.runId },
        );
    }
    const state = current.current;
    const completed = state.phase === "running" && saved.turns.find((turn) => turn.runId === state.turn.id && turn.status !== "queued" && turn.status !== "running");
    if (completed && completed.mode === "answer")
      live.settleSaved(completed.runId, completed.answer ? { kind: "completed", answer: completed.answer }
        : completed.status === "cancelled" ? { kind: "cancelled" } : { kind: "failed", failure: "execution_failed" });
  }, [
    saved.turns.map(({ runId, status }) => `${runId}:${status}`).join(","),
    saved.enabled, messagesObserved, lifecycle.phase,
  ]);

  async function startSaved(
    input: QuestionInput | QuestionComparisonInput,
    mode: "answer" | "comparison",
  ): Promise<boolean> {
    if (current.current.phase !== "idle") return false;
    const runId = crypto.randomUUID();
    transition({ type: "submit", turn: { id: runId, mode, question: input.question, conversationId: saved.selectedId ?? undefined } });
    try {
      const conversationId = await saved.ensure((conversationId) => transition({ type: "created", id: runId, conversationId }));
      const state = readLifecycle();
      if (state.phase !== "submitting" || state.turn.id !== runId) return false;
      const started = mode === "answer"
        ? live.start(input as QuestionInput, { conversationId, runId })
        : comparison.start(input as QuestionComparisonInput, accessToken!, workspaceId!, { conversationId, runId });
      if (started) addTurn({ id: runId, mode, question: input.question, conversationId });
      else transition({ type: "settle", id: runId });
      // The execution reader already owns message progress. Avoid starting a
      // head read against the preceding render's still-enabled observer.
      saved.refresh({ messages: false });
      return started;
    } catch {
      // Creation errors are displayed by the saved model; obsolete selections
      // are discarded there without creating a model execution.
      transition({ type: "settle", id: runId });
      return false;
    }
  }

  async function startAnswer(input: QuestionInput): Promise<boolean> {
    if (saved.enabled) return startSaved(input, "answer");
    if (current.current.phase !== "idle") return false;
    const previousQuestions =
      accessToken && workspaceId
        ? turns
            .flatMap(({ question, answer }) =>
              question && answer && !answer.refusalReason ? [question] : [],
            )
            .slice(-MAX_PREVIOUS_CHAT_QUESTIONS)
            .map((question) =>
              question.slice(0, MAX_PREVIOUS_CHAT_QUESTION_LENGTH).trim(),
            )
        : [];
    const runId = crypto.randomUUID();
    if (
      live.start({
        ...input,
        previousQuestions:
          previousQuestions.length > 0 ? previousQuestions : undefined,
      }, { runId })
    ) {
      addTurn({
        id: runId,
        mode: "answer",
        question: input.question,
      });
      return true;
    }
    return false;
  }

  async function startComparison(input: QuestionComparisonInput): Promise<boolean> {
    if (saved.enabled) return startSaved(input, "comparison");
    if (current.current.phase !== "idle" || !accessToken || !workspaceId) return false;
    const runId = crypto.randomUUID();
    if (comparison.start(input, accessToken, workspaceId, { runId })) {
      addTurn({
        id: runId,
        mode: "comparison",
        question: input.question,
      });
      return true;
    }
    return false;
  }

  function newConversation() {
    if (current.current.phase === "idle") {
      setTurns([]);
      if (saved.enabled) saved.newChat();
    }
  }

  const stored: ConversationTurn[] = saved.turns.map((turn) => {
    const base = { id: turn.runId, question: turn.question, assistantMessageId: turn.assistantMessageId, feedback: turn.feedback };
    if (turn.status === "completed") {
      if (turn.mode === "answer" && turn.answer) return { ...base, mode: "answer", status: "completed", answer: turn.answer };
      if (turn.mode === "comparison" && turn.comparison) return { ...base, mode: "comparison", status: "completed", comparison: turn.comparison };
      return { ...base, mode: turn.mode, status: "failed", failure: "execution_failed" };
    }
    if (turn.status === "failed") return { ...base, mode: turn.mode, status: "failed", failure: "execution_failed" };
    return { ...base, mode: turn.mode, status: turn.status === "queued" || turn.status === "running" ? "pending" : turn.status };
  });
  const merged = new Map(stored.map((turn) => [turn.id, turn]));
  for (const turn of turns) {
    const existing = merged.get(turn.id);
    merged.set(
      turn.id,
      existing && existing.status !== "pending"
        ? existing
        : { ...existing, ...turn },
    );
  }
  return {
    turns: saved.enabled ? [...merged.values()] : turns,
    live,
    comparison,
    startAnswer,
    startComparison,
    newConversation,
    saved,
    submitting: lifecycle.phase === "submitting",
  };
}
