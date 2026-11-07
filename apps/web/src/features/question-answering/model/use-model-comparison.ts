import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { QuestionComparisonInput } from "@rag-study/contracts";
import { api } from "../../../shared/api/rag-api";
import type { ComparisonOutcome } from "./chat-lifecycle";
export type { ComparisonOutcome } from "./chat-lifecycle";

type Saved = { conversationId: string; runId: string };
type Request = { input: QuestionComparisonInput; accessToken: string; workspaceId: string; controller: AbortController; saved?: Saved; recover?: boolean };
type Execution = { id: string; controller: AbortController; session?: { saved: Saved; accessToken: string; workspaceId: string }; terminal?: ComparisonOutcome };
type ComparisonLifecycle = { phase: "idle" } | { phase: "running" | "cancelling"; run: Execution; stopError: boolean };

export function useModelComparison(onFinished: (id: string, result: ComparisonOutcome) => void, onReadingChange?: (reading: boolean) => void) {
  const [state, setState] = useState<ComparisonLifecycle>({ phase: "idle" });
  const current = useRef(state);
  const callbacks = useRef({ onFinished, onReadingChange });
  callbacks.current = { onFinished, onReadingChange };
  function owns(run: Execution) { return current.current.phase !== "idle" && current.current.run === run; }
  function transition(next: ComparisonLifecycle) { current.current = next; setState(next); }
  const mutation = useMutation({
    networkMode: "always",
    mutationFn: ({ input, accessToken, workspaceId, controller, saved, recover }: Request) => saved
      ? api.savedComparison(input, accessToken, workspaceId, saved, controller.signal, recover)
      : api.compareAnswers(input, accessToken, workspaceId, controller.signal),
  });

  useEffect(() => () => {
    if (current.current.phase !== "idle") current.current.run.controller.abort();
    current.current = { phase: "idle" };
  }, []);

  function finish(run: Execution, result: ComparisonOutcome, fromCancel = false) {
    if (current.current.phase === "idle" || current.current.run !== run) return;
    if (current.current.phase === "cancelling" && !fromCancel) { run.terminal = result; return; }
    transition({ phase: "idle" });
    run.controller.abort();
    callbacks.current.onReadingChange?.(false);
    callbacks.current.onFinished(run.id, result);
  }

  function start(input: QuestionComparisonInput, accessToken: string, workspaceId: string, execution: { runId: string; conversationId?: string }, recover = false) {
    if (current.current.phase !== "idle") return false;
    const saved = execution.conversationId ? { conversationId: execution.conversationId, runId: execution.runId } : undefined;
    const run: Execution = { id: execution.runId, controller: new AbortController(), session: saved ? { saved, accessToken, workspaceId } : undefined };
    transition({ phase: "running", run, stopError: false });
    callbacks.current.onReadingChange?.(true);
    mutation.mutate({ input, accessToken, workspaceId, controller: run.controller, saved, recover }, {
      onSuccess: (data) => finish(run, { kind: "completed", data }),
      onError: (error) => finish(run, { kind: "failed", error }),
    });
    return true;
  }

  async function stop() {
    if (current.current.phase !== "running") return;
    const { run } = current.current;
    transition({ phase: "cancelling", run, stopError: false });
    if (!run.session) { finish(run, { kind: "cancelled" }, true); return; }
    const { saved, accessToken, workspaceId } = run.session;
    try {
      const turn = await api.cancelConversationTurn(accessToken, workspaceId, saved.conversationId, saved.runId);
      if (turn.comparison) finish(run, { kind: "completed", data: turn.comparison }, true);
      else if (turn.status === "cancelled") finish(run, { kind: "cancelled" }, true);
      else if (turn.status === "failed") finish(run, { kind: "failed", error: new Error("The comparison could not complete.") }, true);
      else if (owns(run)) {
        transition({ phase: "running", run, stopError: true });
        if (run.terminal) finish(run, run.terminal);
      }
    } catch {
      if (owns(run)) {
        transition({ phase: "running", run, stopError: true });
        if (run.terminal) finish(run, run.terminal);
      }
    }
  }

  function detach() {
    if (current.current.phase !== "idle") current.current.run.controller.abort();
    transition({ phase: "idle" });
    callbacks.current.onReadingChange?.(false);
    mutation.reset();
  }
  return { isPending: state.phase !== "idle", stopping: state.phase === "cancelling", stopError: state.phase !== "idle" && state.stopError, start, stop, detach,
    recover: (input: QuestionComparisonInput, accessToken: string, workspaceId: string, saved: Saved) => start(input, accessToken, workspaceId, saved, true) };
}
