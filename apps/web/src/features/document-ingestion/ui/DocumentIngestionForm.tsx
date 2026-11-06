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
  return <form className="space-y-7" onSubmit={submit} aria-busy={ingest.isPending}><SectionTitle eyebrow="Step 01 · Index" title="Turn a document into retrieval context">The text is split into chunks, screened, converted into embeddings, and stored in pgvector.</SectionTitle><div className="panel grid gap-5 sm:grid-cols-2"><InputLabel label="Source (unique identifier)"><input aria-describedby="source-hint" value={source} onChange={(event) => setSource(event.target.value)} className="field" placeholder="notes/rag-basics" /><span id="source-hint" className="text-xs font-normal text-slate-500">Use the same source to reindex an existing document.</span></InputLabel><InputLabel label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} className="field" placeholder="Notes about RAG" /></InputLabel><label className="grid gap-2 text-sm font-medium text-slate-300 sm:col-span-2">Document content<textarea aria-label="Document content" value={text} onChange={(event) => setText(event.target.value)} className="field min-h-64 resize-y" placeholder="Paste your notes here. Start by explaining a concept, then ask questions in semantic search." /><span className="text-xs font-normal text-slate-500">{text.length.toLocaleString()} characters · chunks are created automatically.</span></label></div><button className="primary-button" disabled={ingest.isPending || text.trim().length < 20} type="submit"><span className={ingest.isPending ? "spinner" : ""} aria-hidden="true" />{ingest.isPending ? "Indexing…" : "Create chunks and index"}</button>{ingest.data && <p role="status" className={ingest.data.highRiskChunks > 0 ? "rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" : "success-message"}>Document indexed with {ingest.data.chunkCount} chunks. {ingest.data.highRiskChunks > 0 ? `${ingest.data.highRiskChunks} high-risk chunk(s) were excluded from generated answers.` : "No high-risk chunks were detected."}</p>}{error && !ingest.isPending && <p role="alert" className="error-message">{error}</p>}</form>;
}
