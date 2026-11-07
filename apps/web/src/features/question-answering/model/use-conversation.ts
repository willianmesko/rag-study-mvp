import { useRef, useState } from "react";
import {
  MAX_PREVIOUS_CHAT_QUESTION_LENGTH, MAX_PREVIOUS_CHAT_QUESTIONS,
  type QuestionComparisonInput, type QuestionComparisonResponse, type QuestionInput, type QuestionResponse
} from "@rag-study/contracts";
import { useLiveAnswer, type AnswerOutcome } from "./use-live-answer";
import { useModelComparison, type ComparisonOutcome } from "./use-model-comparison";

export type ConversationTurn = {
  id: string;
  question: string | null;
  mode: "answer" | "comparison";
  status: "pending" | "completed" | "cancelled" | "failed";
  answer?: QuestionResponse;
  comparison?: QuestionComparisonResponse;
  failure?: AnswerOutcome["failure"];
  error?: unknown;
};

type ActiveTurn = Pick<ConversationTurn, "id" | "question" | "mode">;
type SettledTurn = Omit<ConversationTurn, keyof ActiveTurn | "status"> & {
  status: Exclude<ConversationTurn["status"], "pending">;
};

export function useConversation({ accessToken, workspaceId, scope, onAnswered }: {
  accessToken?: string | null;
  workspaceId?: string;
  scope: string;
  onAnswered: (input: { question: string; response: QuestionResponse }) => void;
}) {
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const active = useRef<ActiveTurn | null>(null);

  function addTurn(turn: ActiveTurn) {
    active.current = turn;
    setTurns((current) => [...current, { ...turn, status: "pending" }]);
  }

  function finishTurn(mode: ActiveTurn["mode"], result: SettledTurn) {
    const turn = active.current;
    if (!turn || turn.mode !== mode) return;
    active.current = null;
    setTurns((current) => current.map((item) => item.id === turn.id ? { ...item, ...result } : item));
    if (turn.question && result.answer && !result.answer.refusalReason) {
      onAnswered({ question: turn.question, response: result.answer });
    }
  }

  function finishAnswer({ answer, cancelled, failure, error }: AnswerOutcome) {
    finishTurn("answer", { answer, failure, error, status: answer ? "completed" : cancelled ? "cancelled" : "failed" });
  }

  function finishComparison(result: ComparisonOutcome) {
    if ("data" in result) finishTurn("comparison", { comparison: result.data, status: "completed" });
    else if ("error" in result) finishTurn("comparison", { error: result.error, status: "failed" });
    else finishTurn("comparison", { status: "cancelled" });
  }

  const live = useLiveAnswer({
    accessToken, workspaceId, scope, onFinished: finishAnswer,
    onRecovered: (id) => {
      if (!active.current) addTurn({ id, mode: "answer", question: null });
    }
  });
  const comparison = useModelComparison(finishComparison);

  function startAnswer(input: QuestionInput) {
    if (active.current) return;
    const previousQuestions = accessToken && workspaceId ? turns
      .flatMap(({ question, answer }) => question && answer && !answer.refusalReason ? [question] : [])
      .slice(-MAX_PREVIOUS_CHAT_QUESTIONS)
      .map((question) => question.slice(0, MAX_PREVIOUS_CHAT_QUESTION_LENGTH).trim()) : [];
    if (live.start({ ...input, previousQuestions: previousQuestions.length > 0 ? previousQuestions : undefined })) {
      addTurn({ id: crypto.randomUUID(), mode: "answer", question: input.question });
    }
  }

  function startComparison(input: QuestionComparisonInput) {
    if (active.current || !accessToken || !workspaceId) return;
    if (comparison.start(input, accessToken, workspaceId)) {
      addTurn({ id: crypto.randomUUID(), mode: "comparison", question: input.question });
    }
  }

  function newConversation() {
    if (!active.current) setTurns([]);
  }

  return { turns, live, comparison, startAnswer, startComparison, newConversation };
}
