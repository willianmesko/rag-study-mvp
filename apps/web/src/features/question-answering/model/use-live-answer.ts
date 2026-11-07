import { useEffect, useRef, useState } from "react";
import { chatRunIdSchema, type ChatRunEvent, type QuestionInput, type QuestionResponse, type QuestionSource } from "@rag-study/contracts";
import { cancelAnswerRun, resumeAnswerStream, startAnswerStream, StreamInterrupted } from "../../../shared/api/answer-stream";
import { api, ApiError } from "../../../shared/api/rag-api";

export type AnswerPhase = "accepted" | "retrieving" | "generating" | "validating" | "cached" | "delivering" | "reconnecting" | "disconnected";
type AnswerState = {
  phase: AnswerPhase | null;
  draft: string;
  citations: QuestionSource[];
};
export type AnswerOutcome = {
  answer?: QuestionResponse;
  failure?: Extract<ChatRunEvent, { type: "error" }>["code"];
  error?: unknown;
  cancelled?: boolean;
};
type Run = {
  controller: AbortController;
  durable?: { id: string; cursor: number; storageKey: string };
  input?: QuestionInput;
  connecting: boolean;
  stopping: boolean;
  conversationId?: string;
};
type Connection = "start" | "resume" | "regular";

const emptyAnswer: AnswerState = { phase: null, draft: "", citations: [] };
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
  onFinished: (result: AnswerOutcome) => void;
  onReadingChange?: (reading: boolean) => void;
  autoRecover?: boolean;
}) {
  const [state, setState] = useState(emptyAnswer);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState(false);
  const active = useRef<Run | null>(null);
  const session = accessToken && workspaceId ? { accessToken, workspaceId } : undefined;
  const latest = useRef({ session, onRecovered, onFinished, onReadingChange });
  const storageKey = session ? `lumora-chat-run:${scope}` : null;

  useEffect(() => { latest.current = { session, onRecovered, onFinished, onReadingChange }; }, [accessToken, workspaceId, onRecovered, onFinished, onReadingChange]);

  useEffect(() => {
    const id = autoRecover && storageKey && readRun(storageKey);
    if (storageKey && id) {
      const run = { controller: new AbortController(), durable: { id, cursor: 0, storageKey }, connecting: false, stopping: false };
      active.current = run;
      latest.current.onRecovered(id);
      setState({ ...emptyAnswer, phase: "reconnecting" });
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

  function finish(run: Run, result: AnswerOutcome) {
    if (active.current !== run) return;
    if (run.durable) clearRun(run.durable);
    active.current = null;
    latest.current.onReadingChange?.(false);
    run.controller.abort();
    setStopping(false);
    setStopError(false);
    setState(emptyAnswer);
    latest.current.onFinished(result);
  }

  async function connect(run: Run, mode: Connection) {
    if (run.connecting) return;
    run.connecting = true;
    latest.current.onReadingChange?.(true);
    const { signal } = run.controller;
    let hasCitations = false;
    const update = (event: ChatRunEvent, sequence: number | null) => {
      if (signal.aborted) return;
      if (run.durable) {
        if (sequence !== null) run.durable.cursor = sequence;
        else { clearRun(run.durable); run.durable = undefined; }
      }
      switch (event.type) {
        case "token":
          if (sequence !== null || hasCitations) {
            setState((previous) => ({ ...previous, draft: previous.draft + event.delta, phase: "delivering" }));
          }
          break;
        case "citations":
          hasCitations = true;
          setState((previous) => ({ ...previous, citations: event.sources, phase: "delivering" }));
          break;
        case "accepted": case "retrieving": case "generating": case "validating": case "cached":
          setState((previous) => ({ ...previous, phase: event.type })); break;
      }
    };

    try {
      for (let attempt = 0; !signal.aborted;) {
        const workspace = latest.current.session;
        try {
          if (mode === "regular" && run.input) {
            if(run.conversationId&&run.durable&&workspace){
              const turn=await api.savedAnswer(run.input,workspace.accessToken,workspace.workspaceId,{conversationId:run.conversationId,runId:run.durable.id},signal);
              finish(run,{answer:turn.answer??undefined,cancelled:turn.status==='cancelled',failure:turn.status==='failed'?'execution_failed':undefined});
            }else finish(run, { answer: await api.answer({ ...run.input, ...workspace, signal }) });
            return;
          }
          if (mode === "resume" ? !run.durable || !workspace : !run.input) throw new StreamInterrupted();
          const event = mode === "resume"
            ? await resumeAnswerStream(run.durable!.id, run.durable!.cursor, workspace!, signal, update)
            : await startAnswerStream(run.input!, { signal, workspace, runId: run.durable?.id,conversationId:run.conversationId }, update);
          if (event.type === "completed") finish(run, { answer: event.response });
          else if (event.type === "cancelled") finish(run, { cancelled: true });
          else finish(run, { failure: event.code });
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
          const admissionUnknown = mode === "resume" && run.durable?.cursor === 0 && run.input &&
            error instanceof ApiError && error.status === 404;
          const tokenChanged = error instanceof ApiError && error.status === 401 &&
            workspace?.accessToken !== latest.current.session?.accessToken;
          if (!run.durable || !(admissionUnknown || tokenChanged || isRetryable(error))) {
            finish(run, { error });
            return;
          }
          const delay = reconnectDelays[attempt++];
          if (delay === undefined) {
            setState((previous) => ({ ...previous, phase: "disconnected" }));
            return;
          }
          setState((previous) => ({ ...previous, phase: "reconnecting" }));
          await waitForRetry(delay, signal);
          mode = mode === "regular" ? "regular" : admissionUnknown ? "start" : "resume";
        }
      }
    } finally {
      run.connecting = false;
      if (active.current === run) latest.current.onReadingChange?.(false);
    }
  }

  function start(input: QuestionInput, saved?: {runId:string;conversationId:string}) {
    if (active.current) return false;
    const supportsStream = typeof ReadableStream !== "undefined";
    const durable = storageKey && (supportsStream||saved) ? { id: saved?.runId??crypto.randomUUID(), cursor: 0, storageKey } : undefined;
    if (durable) saveRun(durable.storageKey, durable.id);
    const run = { controller: new AbortController(), durable, input, connecting: false, stopping: false,conversationId:saved?.conversationId };
    active.current = run;
    setState({ ...emptyAnswer, phase: "accepted" });
    void connect(run, supportsStream ? "start" : "regular");
    return true;
  }

  function resume() {
    const run = active.current;
    if (!run?.durable || run.connecting || run.stopping) return;
    setState((previous) => ({ ...previous, phase: "reconnecting" }));
    void connect(run, run.conversationId&&typeof ReadableStream==="undefined" ? "regular" : "resume");
  }
  function recoverSaved(runId:string,input:QuestionInput,conversationId:string) {
    if(active.current||!storageKey)return;
    const run:Run={controller:new AbortController(),durable:{id:runId,cursor:0,storageKey},input,conversationId,connecting:false,stopping:false};
    active.current=run;setState({...emptyAnswer,phase:'reconnecting'});void connect(run,typeof ReadableStream==='undefined'?'regular':'resume');
  }
  function settleSaved(result:AnswerOutcome){if(active.current)finish(active.current,result);}
  function detach(){const run=active.current;if(run?.durable)clearRun(run.durable);run?.controller.abort();active.current=null;latest.current.onReadingChange?.(false);setState(emptyAnswer);setStopping(false);}

  async function stop() {
    const run = active.current;
    const workspace = latest.current.session;
    if (!run || run.stopping) return;
    if (!run.durable || !workspace) {
      finish(run, { cancelled: true });
      return;
    }
    setStopping(true);
    setStopError(false);
    run.stopping = true;
    const { id } = run.durable;
    const { signal } = run.controller;

    try {
      for (let attempt = 0; !signal.aborted; attempt++) {
        try {
          if(run.conversationId){
            const current=latest.current.session??workspace;
            const turn=await api.cancelConversationTurn(current.accessToken,current.workspaceId,run.conversationId,id);
            if(turn.status==='cancelled')finish(run,{cancelled:true});
            else if(turn.answer)finish(run,{answer:turn.answer});
          }else{
            const status=await cancelAnswerRun(id,latest.current.session??workspace,signal);
            if(status==='cancelled')finish(run,{cancelled:true});
          }
          break;
        } catch (error) {
          if (signal.aborted) return;
          if (!run.durable) { finish(run, { cancelled: true }); return; }
          // A Stop click can race admission. Retry against the same run ID.
          if (attempt >= reconnectDelays.length || run.durable.cursor !== 0 || !isMissingRoute(error)) throw error;
          await waitForRetry(reconnectDelays[attempt]!, signal);
        }
      }
    } catch {
      if (!signal.aborted) setStopError(true);
    } finally {
      run.stopping = false;
      if (!signal.aborted) setStopping(false);
    }
    if (!signal.aborted) resume();
  }

  return { ...state, stopping, stopError, start, resume, stop, recoverSaved, settleSaved, detach };
}
