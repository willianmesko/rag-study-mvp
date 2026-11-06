import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import { documentInputSchema } from "@rag-study/contracts";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";
import { InputLabel } from "../../../shared/ui/InputLabel";
import { SectionTitle } from "../../../shared/ui/SectionTitle";

export function DocumentIngestionForm() {
  const [source, setSource] = useState("notes/first-document");
  const [title, setTitle] = useState("My RAG notes");
  const [text, setText] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const ingest = useMutation({ mutationFn: api.ingest });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setValidationError(null);
      ingest.mutate(documentInputSchema.parse({ source, title: title || undefined, text, metadata: {} }));
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Invalid input.");
    }
  }

  const error = validationError ?? (ingest.error ? getRequestErrorMessage(ingest.error) : null);
  return <form className="space-y-7" onSubmit={submit} aria-busy={ingest.isPending}><SectionTitle eyebrow="Add knowledge" title="Give Lumora something useful to remember">Paste a note or document and Lumora will organize it into searchable knowledge for this workspace.</SectionTitle><div className="panel grid gap-5 sm:grid-cols-2"><InputLabel label="Source name"><input aria-describedby="source-hint" value={source} onChange={(event) => setSource(event.target.value)} className="field" placeholder="notes/rag-basics" /><span id="source-hint" className="text-xs font-normal text-slate-500">Use the same source name when you want to refresh it later.</span></InputLabel><InputLabel label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} className="field" placeholder="Notes about RAG" /></InputLabel><label className="grid gap-2 text-sm font-medium text-slate-300 sm:col-span-2">What should Lumora know?<textarea aria-label="Document content" value={text} onChange={(event) => setText(event.target.value)} className="field min-h-64 resize-y" placeholder="Paste a policy, product note, or explanation here…" /><span className="text-xs font-normal text-slate-500">{text.length.toLocaleString()} characters · Lumora will organize the content automatically.</span></label></div><button className="primary-button" disabled={ingest.isPending || text.trim().length < 20} type="submit"><span className={ingest.isPending ? "spinner" : ""} aria-hidden="true" />{ingest.isPending ? "Saving knowledge…" : "Add to knowledge"}</button>{ingest.data && <p role="status" className={ingest.data.highRiskChunks > 0 ? "rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" : "success-message"}>Knowledge added in {ingest.data.chunkCount} pieces. {ingest.data.highRiskChunks > 0 ? `${ingest.data.highRiskChunks} high-risk piece(s) will stay out of generated answers.` : "Everything looks ready to use."}</p>}{error && !ingest.isPending && <p role="alert" className="error-message">{error}</p>}</form>;
}
