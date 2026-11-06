import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import { documentInputSchema } from "../../../shared/lib/schemas";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";
import { InputLabel } from "../../../shared/ui/InputLabel";
import { SectionTitle } from "../../../shared/ui/SectionTitle";

export function DocumentIngestionForm() {
  const [source, setSource] = useState("notes/primeiro-documento");
  const [title, setTitle] = useState("Minhas notas de RAG");
  const [text, setText] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const ingest = useMutation({ mutationFn: api.ingest });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setValidationError(null);
      ingest.mutate(documentInputSchema.parse({ source, title: title || undefined, text, metadata: {} }));
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Dados inválidos.");
    }
  }

  const error = validationError ?? (ingest.error ? getRequestErrorMessage(ingest.error) : null);
  return <form className="space-y-7" onSubmit={submit}><SectionTitle eyebrow="Etapa 01" title="Indexe um documento">O texto será dividido em chunks, convertido em embeddings e persistido no pgvector. Você poderá reenviar a mesma origem para reindexá-la.</SectionTitle><div className="grid gap-5 rounded-2xl border border-slate-800 bg-slate-900/40 p-6 sm:grid-cols-2"><InputLabel label="Origem (identificador único)"><input value={source} onChange={(event) => setSource(event.target.value)} className="field" placeholder="notes/rag-basics" /></InputLabel><InputLabel label="Título"><input value={title} onChange={(event) => setTitle(event.target.value)} className="field" placeholder="Notas sobre RAG" /></InputLabel><label className="grid gap-2 text-sm font-medium text-slate-300 sm:col-span-2">Conteúdo do documento<textarea value={text} onChange={(event) => setText(event.target.value)} className="field min-h-64 resize-y" placeholder="Cole suas anotações aqui. Comece explicando um conceito e depois faça perguntas na busca semântica." /></label></div><button className="primary-button" disabled={ingest.isPending} type="submit">{ingest.isPending ? "Indexando…" : "Criar chunks e indexar"}</button>{ingest.data && <p className={ingest.data.highRiskChunks > 0 ? "rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" : "success-message"}>Documento indexado com {ingest.data.chunkCount} chunks. {ingest.data.highRiskChunks > 0 ? `${ingest.data.highRiskChunks} chunk(s) de alto risco foram excluídos das respostas geradas.` : "Nenhum chunk de alto risco foi detectado."}</p>}{error && !ingest.isPending && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{error}</p>}</form>;
}
