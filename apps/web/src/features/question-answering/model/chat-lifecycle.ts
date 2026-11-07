import type { ChatRunEvent, QuestionComparisonResponse, QuestionResponse } from "@rag-study/contracts";

export type AnswerOutcome =
  | { kind: "completed"; answer: QuestionResponse }
  | { kind: "cancelled" }
  | { kind: "failed"; failure?: Extract<ChatRunEvent, { type: "error" }>["code"]; error?: unknown };

export type ComparisonOutcome =
  | { kind: "completed"; data: QuestionComparisonResponse }
  | { kind: "cancelled" }
  | { kind: "failed"; error: unknown };

export type ActiveTurn = {
  id: string;
  question: string | null;
  mode: "answer" | "comparison";
  conversationId?: string;
};

export type TurnResult =
  | { status: "completed"; mode: "answer"; answer: QuestionResponse; comparison?: never }
  | { status: "completed"; mode: "comparison"; comparison: QuestionComparisonResponse; answer?: never }
  | { status: "cancelled"; answer?: never; comparison?: never }
  | { status: "failed"; failure?: Extract<ChatRunEvent, { type: "error" }>["code"]; error?: unknown; answer?: never; comparison?: never };

export type ConversationTurn = {
  id: string;
  question: string | null;
  assistantMessageId?: string;
  feedback?: "up" | "down" | null;
} & (
  | { status: "pending" | "cancelled"; mode: ActiveTurn["mode"]; answer?: never; comparison?: never; failure?: never; error?: never }
  | (Extract<TurnResult, { status: "failed" }> & { mode: ActiveTurn["mode"] })
  | (Extract<TurnResult, { status: "completed" }> & { failure?: never; error?: never })
);

export type ChatLifecycle =
  | { phase: "idle" }
  | { phase: "submitting"; turn: ActiveTurn }
  | { phase: "running"; turn: ActiveTurn };

export type ChatTransition =
  | { type: "submit"; turn: ActiveTurn }
  | { type: "admit"; turn: ActiveTurn }
  | { type: "created"; id: string; conversationId: string }
  | { type: "settle"; id: string }
  | { type: "detach" };

/** Execution identity, rather than response mode or render timing, owns a turn. */
export function transitionChat(state: ChatLifecycle, event: ChatTransition): ChatLifecycle {
  switch (event.type) {
    case "submit": return state.phase === "idle" ? { phase: "submitting", turn: event.turn } : state;
    case "created": return state.phase === "submitting" && state.turn.id === event.id
      ? { ...state, turn: { ...state.turn, conversationId: event.conversationId } } : state;
    case "admit":
      return state.phase === "idle" || (state.phase === "submitting" && state.turn.id === event.turn.id)
        ? { phase: "running", turn: event.turn } : state;
    case "settle": return state.phase !== "idle" && state.turn.id === event.id ? { phase: "idle" } : state;
    case "detach": return { phase: "idle" };
  }
}
