import { useEffect, useRef, useState } from "react";
import {
  MAX_PREVIOUS_CHAT_QUESTION_LENGTH,
  MAX_PREVIOUS_CHAT_QUESTIONS,
  type QuestionComparisonInput,
  type QuestionComparisonResponse,
  type QuestionInput,
  type QuestionResponse,
} from "@rag-study/contracts";
import { useLiveAnswer, type AnswerOutcome } from "./use-live-answer";
import {
  useModelComparison,
  type ComparisonOutcome,
} from "./use-model-comparison";
import { useSavedConversations } from "./use-saved-conversations";

export type ConversationTurn = {
  id: string;
  question: string | null;
  mode: "answer" | "comparison";
  status: "pending" | "completed" | "cancelled" | "failed";
  answer?: QuestionResponse;
  comparison?: QuestionComparisonResponse;
  failure?: AnswerOutcome["failure"];
  error?: unknown;
  assistantMessageId?: string;
  feedback?: "up" | "down" | null;
};

type ActiveTurn = Pick<ConversationTurn, "id" | "question" | "mode"> & {
  conversationId?: string;
};
type SettledTurn = Omit<ConversationTurn, keyof ActiveTurn | "status"> & {
  status: Exclude<ConversationTurn["status"], "pending">;
};

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
  const [submitting, setSubmitting] = useState(false);
  const active = useRef<ActiveTurn | null>(null);
  const submittingRef = useRef(false);

  function addTurn(turn: ActiveTurn) {
    active.current = turn;
    setTurns((current) => [...current, { ...turn, status: "pending" }]);
  }

  function finishTurn(mode: ActiveTurn["mode"], result: SettledTurn) {
    const turn = active.current;
    if (!turn || turn.mode !== mode) return;
    active.current = null;
    setTurns((current) =>
      current.map((item) =>
        item.id === turn.id ? { ...item, ...result } : item,
      ),
    );
    if (
      !saved.enabled &&
      turn.question &&
      result.answer &&
      !result.answer.refusalReason
    ) {
      onAnswered({ question: turn.question, response: result.answer });
    }
    if (saved.enabled) saved.refresh();
  }

  function finishAnswer({ answer, cancelled, failure, error }: AnswerOutcome) {
    finishTurn("answer", {
      answer,
      failure,
      error,
      status: answer ? "completed" : cancelled ? "cancelled" : "failed",
    });
  }

  function finishComparison(result: ComparisonOutcome) {
    if ("data" in result)
      finishTurn("comparison", {
        comparison: result.data,
        status: "completed",
      });
    else if ("error" in result)
      finishTurn("comparison", { error: result.error, status: "failed" });
    else finishTurn("comparison", { status: "cancelled" });
  }

  const live = useLiveAnswer({
    accessToken,
    workspaceId,
    scope,
    onFinished: finishAnswer,
    onReadingChange: setReaderOwned,
    autoRecover: !accessToken || (!saved.enabled && !saved.initializing),
    onRecovered: (id) => {
      if (!active.current) addTurn({ id, mode: "answer", question: null });
    },
  });
  const comparison = useModelComparison(finishComparison, setReaderOwned);

  const previousSelection = useRef(saved.selectedId);
  useEffect(() => {
    if (previousSelection.current === saved.selectedId) return;
    previousSelection.current = saved.selectedId;
    if (active.current?.conversationId !== saved.selectedId) {
      active.current = null;
      setTurns([]);
      live.detach();
      comparison.detach();
    }
  }, [saved.selectedId]);
  useEffect(() => {
    if (!saved.enabled || !messagesObserved) return;
    const pending = saved.turns.find(
      (turn) => turn.status === "queued" || turn.status === "running",
    );
    if (pending && !active.current && !submitting) {
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
    const completed =
      active.current &&
      saved.turns.find(
        (turn) =>
          turn.runId === active.current!.id &&
          turn.status !== "queued" &&
          turn.status !== "running",
      );
    if (completed && completed.mode === "answer")
      live.settleSaved({
        answer: completed.answer ?? undefined,
        cancelled: completed.status === "cancelled",
        failure: completed.status === "failed" ? "execution_failed" : undefined,
      });
  }, [
    saved.turns.map(({ runId, status }) => `${runId}:${status}`).join(","),
    saved.enabled,
    messagesObserved,
    submitting,
  ]);

  async function startSaved(
    input: QuestionInput | QuestionComparisonInput,
    mode: "answer" | "comparison",
  ) {
    if (active.current || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const conversationId = await saved.ensure(),
        runId = crypto.randomUUID();
      if (mode === "answer") {
        if (live.start(input as QuestionInput, { conversationId, runId }))
          addTurn({
            id: runId,
            mode,
            question: input.question,
            conversationId,
          });
      } else if (
        comparison.start(
          input as QuestionComparisonInput,
          accessToken!,
          workspaceId!,
          { conversationId, runId },
        )
      )
        addTurn({ id: runId, mode, question: input.question, conversationId });
      saved.refresh();
    } catch {
      /* The saved-conversation model displays the recoverable error. */
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function startAnswer(input: QuestionInput) {
    if (saved.enabled) {
      void startSaved(input, "answer");
      return;
    }
    if (active.current) return;
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
    if (
      live.start({
        ...input,
        previousQuestions:
          previousQuestions.length > 0 ? previousQuestions : undefined,
      })
    ) {
      addTurn({
        id: crypto.randomUUID(),
        mode: "answer",
        question: input.question,
      });
    }
  }

  function startComparison(input: QuestionComparisonInput) {
    if (saved.enabled) {
      void startSaved(input, "comparison");
      return;
    }
    if (active.current || !accessToken || !workspaceId) return;
    if (comparison.start(input, accessToken, workspaceId)) {
      addTurn({
        id: crypto.randomUUID(),
        mode: "comparison",
        question: input.question,
      });
    }
  }

  function newConversation() {
    if (!active.current) {
      setTurns([]);
      if (saved.enabled) saved.newChat();
    }
  }

  const stored: ConversationTurn[] = saved.turns.map((turn) => ({
    id: turn.runId,
    mode: turn.mode,
    question: turn.question,
    status:
      turn.status === "queued" || turn.status === "running"
        ? "pending"
        : turn.status,
    answer: turn.answer ?? undefined,
    comparison: turn.comparison ?? undefined,
    assistantMessageId: turn.assistantMessageId,
    feedback: turn.feedback,
    failure: turn.status === "failed" ? "execution_failed" : undefined,
  }));
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
    submitting,
  };
}
