import type { QuestionSource } from "@rag-study/contracts";

export type DeliveryPhase = "accepted" | "retrieving" | "generating" | "validating" | "cached" | "delivering";
export type AnswerPhase = DeliveryPhase | "reconnecting" | "disconnected";
type Progress = { id: string; draft: string; citations: QuestionSource[]; stopError: boolean };
export type AnswerLifecycle =
  | { status: "idle" }
  | (Progress & (
    | { status: "receiving"; phase: DeliveryPhase }
    | { status: "reconnecting"; phase: "reconnecting" }
    | { status: "disconnected"; phase: "disconnected" }
    | { status: "cancelling"; phase: AnswerPhase }
  ));
export type AnswerTransition =
  | { type: "begin"; id: string; phase: "accepted" | "reconnecting" }
  | { type: "progress"; id: string; phase: AnswerPhase }
  | { type: "token"; id: string; delta: string }
  | { type: "citations"; id: string; sources: QuestionSource[] }
  | { type: "cancel"; id: string }
  | { type: "cancel-unconfirmed"; id: string }
  | { type: "cancel-resume"; id: string }
  | { type: "finish"; id: string }
  | { type: "detach" };

function withPhase(progress: Progress, phase: AnswerPhase): Exclude<AnswerLifecycle, { status: "idle" }> {
  if (phase === "reconnecting") return { ...progress, status: "reconnecting", phase };
  if (phase === "disconnected") return { ...progress, status: "disconnected", phase };
  return { ...progress, status: "receiving", phase };
}

export function transitionAnswer(state: AnswerLifecycle, event: AnswerTransition): AnswerLifecycle {
  if (event.type === "detach") return { status: "idle" };
  if (event.type === "begin") return state.status === "idle"
    ? withPhase({ id: event.id, draft: "", citations: [], stopError: false }, event.phase) : state;
  if (state.status === "idle" || state.id !== event.id) return state;
  switch (event.type) {
    case "finish": return { status: "idle" };
    case "cancel": return { ...state, status: "cancelling", stopError: false };
    case "cancel-unconfirmed": return withPhase({ ...state, stopError: true }, state.phase);
    case "cancel-resume": return withPhase(state, state.phase);
    // Keep cancellation visible while a concurrent stream is still draining.
    case "progress": return state.status === "cancelling" ? { ...state, phase: event.phase } : withPhase(state, event.phase);
    case "token": return state.status === "cancelling" ? { ...state, draft: state.draft + event.delta, phase: "delivering" } : withPhase({ ...state, draft: state.draft + event.delta }, "delivering");
    case "citations": return state.status === "cancelling" ? { ...state, citations: event.sources, phase: "delivering" } : withPhase({ ...state, citations: event.sources }, "delivering");
  }
}
