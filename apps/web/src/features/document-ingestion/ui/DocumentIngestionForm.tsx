import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { documentInputSchema } from "@rag-study/contracts";
import { api } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";
import { InputLabel } from "../../../shared/ui/InputLabel";
import { SectionTitle } from "../../../shared/ui/SectionTitle";

export function DocumentIngestionForm() {
  const { t, locale } = useLocale();
  const [source, setSource] = useState("notes/first-document");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [invalidInput, setInvalidInput] = useState(false);
  const ingest = useMutation({ mutationFn: api.ingest });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = documentInputSchema.safeParse({ source: source.trim(), title: title.trim() || undefined, text, metadata: {} });
    setInvalidInput(!input.success);
    if (input.success) ingest.mutate(input.data);
  }

  const error = invalidInput ? t("Check the source name, title, and document text.", "Confira a identificação da fonte, o título e o texto.")
    : ingest.error ? getRequestErrorMessage(ingest.error, locale) : null;

  return (
    <form className="space-y-7" onSubmit={submit} aria-busy={ingest.isPending}>
      <SectionTitle eyebrow={t("Add knowledge", "Adicione conhecimento")} title={t("Make a document searchable", "Torne um documento pesquisável")}>
        {t("Paste a note or document. Lumora prepares the text for search.", "Cole uma anotação ou documento. O Lumora prepara o texto para a busca.")}
      </SectionTitle>
      <div className="panel grid gap-5 sm:grid-cols-2">
        <InputLabel label={t("Source ID", "Identificação da fonte")}>
          <input aria-describedby="source-hint" value={source} onChange={(event) => setSource(event.target.value)} maxLength={1000} required className="field" placeholder="notes/rag-basics" />
          <span id="source-hint" className="text-xs font-normal text-slate-400">{t("Use the same ID to update this source later.", "Use a mesma identificação para atualizar a fonte depois.")}</span>
        </InputLabel>
        <InputLabel label={t("Title (optional)", "Título (opcional)")}>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} className="field" placeholder={t("My RAG notes", "Minhas anotações sobre RAG")} />
        </InputLabel>
        <label className="grid gap-2 text-sm font-medium text-slate-300 sm:col-span-2">
          {t("Document text", "Texto do documento")}
          <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={500000} className="field min-h-64 resize-y"
            placeholder={t("Paste a policy, note, or explanation here…", "Cole aqui uma política, anotação ou explicação…")} />
          <span className="text-xs font-normal text-slate-400">{text.length.toLocaleString(locale)} {t("characters", "caracteres")}</span>
        </label>
      </div>
      <button className="primary-button" disabled={ingest.isPending || text.trim().length < 20} type="submit">
        {ingest.isPending && <span className="spinner" aria-hidden="true" />}
        {ingest.isPending ? t("Saving document…", "Salvando documento…") : t("Add document", "Adicionar documento")}
      </button>
      {ingest.data && <p role="status" className={ingest.data.highRiskChunks > 0 ? "rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" : "success-message"}>
        {t(`Document indexed in ${ingest.data.chunkCount.toLocaleString(locale)} passages.`, `Documento indexado em ${ingest.data.chunkCount.toLocaleString(locale)} trechos.`)}{" "}
        {ingest.data.highRiskChunks > 0 && t("High-risk passages are excluded from generated answers.", "Os trechos de alto risco ficam fora das respostas geradas.")}
      </p>}
      {error && !ingest.isPending && <p role="alert" className="error-message">{error}</p>}
    </form>
  );
}
