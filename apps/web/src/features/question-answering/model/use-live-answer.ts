import { useEffect, useRef, useState } from "react";
import { chatRunIdSchema, type ChatRunEvent, type QuestionInput } from "@rag-study/contracts";
import { cancelAnswerRun, resumeAnswerStream, startAnswerStream, StreamInterrupted } from "../../../shared/api/answer-stream";
import { api, ApiError } from "../../../shared/api/rag-api";

import { transitionAnswer, type AnswerLifecycle, type AnswerTransition } from "./answer-lifecycle";
import type { AnswerOutcome } from "./chat-lifecycle";
export type { AnswerPhase } from "./answer-lifecycle";
export type { AnswerOutcome } from "./chat-lifecycle";
type Run = {
  id: string;
  terminal?: AnswerOutcome;
  controller: AbortController;
  durable?: { id: string; cursor: number; storageKey: string };
  input?: QuestionInput;
  connecting: boolean;
  stopping: boolean;
  conversationId?: string;
  admitted?: boolean;
};
type Connection = "start" | "resume" | "regular";


const reconnectDelays = [400, 1_200, 3_000];

function readRun(key: string): string | null {
  try {
    const parsed = chatRunIdSchema.safeParse(window.sessionStorage.getItem(key));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

function saveRun(key: string, runId: string) {
  try { window.sessionStorage.setItem(key, runId); } catch { /* The current tab can still reconnect. */ }
}

function clearRun({ storageKey, id }: NonNullable<Run["durable"]>) {
  try { if (readRun(storageKey) === id) window.sessionStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ }
}

function waitForRetry(delay: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    function done() {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    const timer = window.setTimeout(done, delay);
    signal.addEventListener("abort", done, { once: true });
  });
}

function isMissingRoute(error: unknown) {
  return error instanceof ApiError && (error.status === 404 || error.status === 405);
}

function isRetryable(error: unknown) {
  return error instanceof TypeError || error instanceof StreamInterrupted ||
    (error instanceof ApiError && (error.status === 408 || error.status >= 500));
}

export function useLiveAnswer({ accessToken, workspaceId, scope, onRecovered, onFinished, onReadingChange, autoRecover = true }: {
  accessToken?: string | null;
  workspaceId?: string;
  scope: string;
  onRecovered: (runId: string) => void;
  onFinished: (runId: string, result: AnswerOutcome) => void;
  onReadingChange?: (reading: boolean) => void;
  autoRecover?: boolean;
}) {
  const [state, setState] = useState<AnswerLifecycle>({ status: "idle" });
  const stateRef = useRef(state);
  function transition(event: AnswerTransition) {
    const next = transitionAnswer(stateRef.current, event);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
  }
  const active = useRef<Run | null>(null);
  const session = accessToken && workspaceId ? { accessToken, workspaceId } : undefined;
  const latest = useRef({ session, onRecovered, onFinished, onReadingChange });
  const storageKey = session ? `lumora-chat-run:${scope}` : null;

  useEffect(() => { latest.current = { session, onRecovered, onFinished, onReadingChange }; }, [accessToken, workspaceId, onRecovered, onFinished, onReadingChange]);

  useEffect(() => {
    transition({ type: "detach" });
    const id = autoRecover && storageKey && readRun(storageKey);
    if (storageKey && id) {
      const run: Run = { id, controller: new AbortController(), durable: { id, cursor: 0, storageKey }, connecting: false, stopping: false };
      active.current = run;
      latest.current.onRecovered(id);
      transition({ type: "begin", id, phase: "reconnecting" });
      void connect(run, "resume");
    }
    window.addEventListener("online", resume);
    return () => {
      window.removeEventListener("online", resume);
      active.current?.controller.abort();
      active.current = null;
      latest.current.onReadingChange?.(false);
    };
  }, [storageKey,autoRecover]);

  function finish(run: Run, result: AnswerOutcome, source: "reader" | "cancel" = "reader") {
    if (active.current !== run) return;
    if (run.stopping && source === "reader") { run.terminal = result; return; }
    if (run.durable) clearRun(run.durable);
    active.current = null;
    latest.current.onReadingChange?.(false);
    run.controller.abort();
    transition({ type: "finish", id: run.id });
    latest.current.onFinished(run.id, result);
  }

  async function connect(run: Run, mode: Connection) {
    if (active.current !== run || run.connecting || run.stopping) return;
    run.connecting = true;
    latest.current.onReadingChange?.(true);
    const { signal } = run.controller;
    let hasCitations = false;
    const update = (event: ChatRunEvent, sequence: number | null) => {
      if (signal.aborted || active.current !== run) return;
      if (run.durable) {
        if (sequence !== null) { run.durable.cursor = sequence; run.admitted = true; }
        else { clearRun(run.durable); run.durable = undefined; }
      }
      switch (event.type) {
        case "token":
          if (sequence !== null || hasCitations) {
            transition({ type: "token", id: run.id, delta: event.delta });
          }
          break;
        case "citations":
          hasCitations = true;
          transition({ type: "citations", id: run.id, sources: event.sources });
          break;
        case "accepted": case "retrieving": case "generating": case "validating": case "cached":
          transition({ type: "progress", id: run.id, phase: event.type }); break;
      }
    };

    try {
      for (let attempt = 0; !signal.aborted;) {
        const workspace = latest.current.session;
        try {
          if (mode === "regular" && run.input) {
            if(run.conversationId&&run.durable&&workspace){
              const turn=await api.savedAnswer(run.input,workspace.accessToken,workspace.workspaceId,{conversationId:run.conversationId,runId:run.durable.id},signal,{recover:run.admitted,onAccepted:()=>{run.admitted=true;}});
              finish(run, turn.answer ? { kind: "completed", answer: turn.answer }
                : turn.status === "cancelled" ? { kind: "cancelled" } : { kind: "failed", failure: "execution_failed" });
            }else finish(run, { kind: "completed", answer: await api.answer({ ...run.input, ...workspace, signal }) });
            return;
          }
          if (mode === "resume" ? !run.durable || !workspace : !run.input) throw new StreamInterrupted();
          const event = mode === "resume"
            ? await resumeAnswerStream(run.durable!.id, run.durable!.cursor, workspace!, signal, update)
            : await startAnswerStream(run.input!, { signal, workspace, runId: run.durable?.id,conversationId:run.conversationId }, update);
          if (event.type === "completed") finish(run, { kind: "completed", answer: event.response });
          else if (event.type === "cancelled") finish(run, { kind: "cancelled" });
          else finish(run, { kind: "failed", failure: event.code });
          return;
        } catch (error) {
          if (signal.aborted) return;
          if (mode === "start" && attempt === 0 && isMissingRoute(error) && !run.conversationId) {
            // A missing stream route rejected the request before admission.
            if (run.durable) clearRun(run.durable);
            run.durable = undefined;
            mode = "regular";
            continue;
          }
          const admissionUnknown = mode === "resume" && !run.admitted && run.durable?.cursor === 0 && run.input &&
            error instanceof ApiError && error.status === 404;
          const tokenChanged = error instanceof ApiError && error.status === 401 &&
            workspace?.accessToken !== latest.current.session?.accessToken;
          if (!run.durable || !(admissionUnknown || tokenChanged || isRetryable(error))) {
            finish(run, { kind: "failed", error });
            return;
          }
          const delay = reconnectDelays[attempt++];
          if (delay === undefined) {
            transition({ type: "progress", id: run.id, phase: "disconnected" });
            return;
          }
          transition({ type: "progress", id: run.id, phase: "reconnecting" });
          await waitForRetry(delay, signal);
          mode = mode === "regular" ? "regular" : admissionUnknown ? "start" : "resume";
        }
      }
    } finally {
      run.connecting = false;
      if (active.current === run && !run.stopping) latest.current.onReadingChange?.(false);
    }
  }

  function start(input: QuestionInput, execution: {runId:string;conversationId?:string}) {
    if (active.current) return false;
    const supportsStream = typeof ReadableStream !== "undefined";
    const durable = storageKey && (supportsStream||execution.conversationId) ? { id: execution.runId, cursor: 0, storageKey } : undefined;
    if (durable) saveRun(durable.storageKey, durable.id);
    const run: Run = { id: execution.runId, controller: new AbortController(), durable, input, connecting: false, stopping: false,conversationId:execution.conversationId };
    active.current = run;
    transition({ type: "begin", id: run.id, phase: "accepted" });
    void connect(run, supportsStream ? "start" : "regular");
    return true;
  }

  function resume() {
    const run = active.current;
    if (!run?.durable || run.connecting || run.stopping) return;
    transition({ type: "progress", id: run.id, phase: "reconnecting" });
    void connect(run, run.conversationId&&typeof ReadableStream==="undefined" ? "regular" : "resume");
  }
  function recoverSaved(runId:string,input:QuestionInput,conversationId:string) {
    if(active.current||!storageKey)return;
    const run:Run={id:runId,controller:new AbortController(),durable:{id:runId,cursor:0,storageKey},input,conversationId,admitted:true,connecting:false,stopping:false};
    active.current=run;transition({ type: "begin", id: run.id, phase: "reconnecting" });void connect(run,typeof ReadableStream==='undefined'?'regular':'resume');
  }
  function settleSaved(runId: string, result:AnswerOutcome){if(active.current?.id === runId)finish(active.current,result);}
  function detach(){const run=active.current;if(run?.durable)clearRun(run.durable);run?.controller.abort();active.current=null;latest.current.onReadingChange?.(false);transition({ type: "detach" });}

  async function stop() {
    const run = active.current;
    const workspace = latest.current.session;
    if (!run || run.stopping) return;
    if (!run.durable || !workspace) {
      finish(run, { kind: "cancelled" });
      return;
    }
    transition({ type: "cancel", id: run.id });
    run.stopping = true;
    const { id } = run.durable;
    const { signal } = run.controller;

    try {
      for (let attempt = 0; !signal.aborted; attempt++) {
        try {
          if(run.conversationId){
            const current=latest.current.session??workspace;
            const turn=await api.cancelConversationTurn(current.accessToken,current.workspaceId,run.conversationId,id);
            if(turn.status==='cancelled')finish(run,{kind:"cancelled"}, "cancel");
            else if(turn.answer)finish(run,{kind:"completed", answer:turn.answer}, "cancel");
          }else{
            const status=await cancelAnswerRun(id,latest.current.session??workspace,signal);
            if(status==='cancelled')finish(run,{kind:"cancelled"}, "cancel");
            else if(run.terminal)finish(run,run.terminal, "cancel");
          }
          break;
        } catch (error) {
          if (signal.aborted) return;
          if (!run.durable) { finish(run, { kind: "cancelled" }); return; }
          // A Stop click can race admission. Retry against the same run ID.
          if (attempt >= reconnectDelays.length || run.durable.cursor !== 0 || !isMissingRoute(error)) throw error;
          await waitForRetry(reconnectDelays[attempt]!, signal);
        }
      }
    } catch {
      if (!signal.aborted && active.current === run) {
        if (run.terminal) finish(run, run.terminal, "cancel");
        else transition({ type: "cancel-unconfirmed", id: run.id });
      }
    } finally {
      run.stopping = false;
      if (!signal.aborted && active.current === run) {
        if (run.terminal) finish(run, run.terminal, "cancel");
        else transition({ type: "cancel-resume", id: run.id });
      }
    }
    if (!signal.aborted) resume();
  }

  const progress = state.status === "idle" ? { phase: null, draft: "", citations: [], stopError: false } : state;
  return { ...progress, stopping: state.status === "cancelling", start, resume, stop, recoverSaved, settleSaved, detach };
}
