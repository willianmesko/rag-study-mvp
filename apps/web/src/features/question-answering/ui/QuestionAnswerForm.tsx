import { useRef, useState, type FormEvent } from "react";
import type { AnswerStreamEvent, QuestionResponse, QuestionSource } from "../../../shared/api/rag-api";
import { api } from "../../../shared/api/rag-api";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";
import { questionInputSchema } from "@rag-study/contracts";
import { InputLabel } from "../../../shared/ui/InputLabel";
import { SectionTitle } from "../../../shared/ui/SectionTitle";
import { RagEvidencePanel } from "../../../shared/ui/RagEvidencePanel";

type StreamStatus = "idle" | "accepted" | "retrieving" | "generating" | "validating" | "cached" | "completed" | "error";

const statusCopy: Record<Exclude<StreamStatus, "idle" | "completed" | "error">, string> = {
  accepted: "Request accepted",
  retrieving: "Finding the closest knowledge",
  generating: "Writing with context",
  validating: "Checking citations",
  cached: "Opening a cached answer"
};

export function QuestionAnswerForm({ onAnswered, onInspectSource, accessToken, workspaceId, workspaceName }: { onAnswered: (input: { question: string; response: QuestionResponse }) => void; onInspectSource: (source: QuestionSource) => void; accessToken?: string | null; workspaceId?: string; workspaceName?: string }) {
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(5);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [streamedAnswer, setStreamedAnswer] = useState("");
  const [answer, setAnswer] = useState<QuestionResponse | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const receivedEventRef = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setValidationError(null);
      setStreamError(null);
      setAnswer(null);
      setStreamedAnswer("");
      const input = questionInputSchema.parse({ question, topK });
      const controller = new AbortController();
      controllerRef.current = controller;
      receivedEventRef.current = false;
      setStreamStatus("accepted");
      const response = await api.answerStream({ ...input, accessToken: accessToken ?? undefined, workspaceId, signal: controller.signal }, handleStreamEvent);
      setAnswer(response);
      setStreamedAnswer(response.answer);
      setStreamStatus("completed");
      onAnswered({ question: input.question, response });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStreamStatus("idle");
        return;
      }
      if (!receivedEventRef.current) {
        try {
          const input = questionInputSchema.parse({ question, topK });
          const response = await api.answer({ ...input, accessToken: accessToken ?? undefined, workspaceId });
          setAnswer(response);
          setStreamedAnswer(response.answer);
          setStreamStatus("completed");
          onAnswered({ question: input.question, response });
          return;
        } catch (fallbackError) {
          setStreamError(getRequestErrorMessage(fallbackError));
        }
      } else {
        setStreamError(getRequestErrorMessage(error));
      }
      setStreamStatus("error");
    } finally {
      controllerRef.current = null;
    }
  }

  function handleStreamEvent(event: AnswerStreamEvent) {
    receivedEventRef.current = true;
    if (event.type === "token") {
      setStreamStatus("generating");
      setStreamedAnswer((value) => value + event.delta);
      return;
    }
    if (event.type === "completed") return;
    if (event.type === "error") {
      setStreamError(event.error);
      return;
    }
    setStreamStatus(event.type);
  }

  function cancel() {
    controllerRef.current?.abort();
  }

  const isStreaming = streamStatus !== "idle" && streamStatus !== "completed" && streamStatus !== "error";
  const error = validationError ?? streamError;
  const displayedAnswer = answer?.answer ?? streamedAnswer;
  return <form className="space-y-7" onSubmit={submit} aria-busy={isStreaming}>
    <SectionTitle eyebrow="Ask Lumora" title="Get a grounded answer">Lumora checks the selected workspace, uses the most relevant knowledge, and shows the sources behind every response.</SectionTitle>
    <div className="panel space-y-5"><div className="workspace-context"><span className="workspace-context__dot" /><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-300">Answering from</p><p className="mt-1 text-sm font-medium text-slate-100">{workspaceName ?? "Demo workspace"}</p></div><span className="ml-auto text-xs text-slate-500">{accessToken ? "Private knowledge" : "Public knowledge"}</span></div><InputLabel label="What would you like to know?"><textarea aria-describedby="question-hint" value={question} onChange={(event) => setQuestion(event.target.value)} className="field min-h-32 resize-y" placeholder="Explain RAG using my notes." /><span id="question-hint" className="text-xs font-normal text-slate-500">One focused question usually leads to the clearest answer.</span></InputLabel><div className="flex flex-wrap items-center justify-between gap-4"><label className="grid gap-2 text-xs font-medium text-slate-400">Knowledge pieces<select aria-label="Number of sources to retrieve" value={topK} onChange={(event) => setTopK(Number(event.target.value))} className="field w-36"><option value={3}>3 pieces</option><option value={5}>5 pieces</option><option value={8}>8 pieces</option></select></label><div className="flex flex-wrap gap-2">{isStreaming && <button className="secondary-button" type="button" onClick={cancel}>Stop answer</button>}<button className="primary-button" disabled={isStreaming || question.trim().length === 0} type="submit"><span className={isStreaming ? "spinner" : ""} aria-hidden="true" />{isStreaming ? "Working with context…" : "Ask Lumora"}</button></div></div></div>
    {isStreaming && <section className="stream-status-card" role="status" aria-live="polite"><div className="flex items-center justify-between gap-4"><div><p className="eyebrow">Live answer</p><p className="mt-2 text-sm text-slate-200">{streamStatusCopy(streamStatus)}</p></div><span className="status-pill status-pill--success"><span className="size-1.5 animate-pulse rounded-full bg-emerald-300" />Streaming</span></div><div className="mt-4 h-1 overflow-hidden rounded-full bg-slate-800"><div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" /></div>{streamedAnswer && <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-200">{streamedAnswer}<span className="ml-1 inline-block h-4 w-1 animate-pulse bg-cyan-300 align-[-2px]" /></p>}</section>}
    {displayedAnswer && !isStreaming && answer && <><div className="panel animate-fade-up border-cyan-500/20 bg-cyan-500/5"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Your answer</p><p className="mt-1 text-xs text-slate-500">Built from {answer.sources.length} source{answer.sources.length === 1 ? "" : "s"} in this workspace.</p></div><span className={`status-pill ${answer.refusalReason ? "status-pill--warning" : "status-pill--success"}`}>{answer.refusalReason ? "Safe refusal" : answer.structuredOutput ? "Citations validated" : "Sources included"}</span></div><p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-slate-200">{displayedAnswer}</p></div><RagEvidencePanel sources={answer.sources} onInspectSource={onInspectSource} /></>}
    {error && !isStreaming && <p role="alert" className="error-message">{error}</p>}
  </form>;
}

function streamStatusCopy(status: StreamStatus): string {
  if (status === "completed") return "Complete";
  if (status === "error") return "The stream stopped";
  if (status === "idle") return "Ready";
  return statusCopy[status];
}
