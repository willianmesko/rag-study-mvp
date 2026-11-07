import { useEffect, useId, useState, type FormEvent } from "react";
import { documentFiltersSchema, type DocumentFilters as Filters } from "@rag-study/contracts";
import type { ManagedDocument } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { SelectField } from "../../../shared/ui/SelectField";

export function DocumentFilters({ value, documents, onChange }: {
  value: Filters;
  documents: ManagedDocument[];
  onChange: (filters: Filters) => void;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(value);
  const [query, setQuery] = useState(value.q ?? "");
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  useEffect(() => { setQuery(value.q ?? ""); }, [value.q]);
  useEffect(() => { setDraft(value); setInvalid(false); }, [value.source, value.documentId, value.language, value.format, value.from, value.to]);
  const active = Object.values(value).some((item) => item !== undefined);
  const count = Object.entries(value).filter(([key, item]) => key !== "q" && item !== undefined).length;
  const update = <K extends keyof Filters>(key: K, next: Filters[K]) => { setDraft((current) => ({ ...current, [key]: next })); setInvalid(false); };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = documentFiltersSchema.safeParse(Object.fromEntries(Object.entries({ ...draft, q: value.q })
      .flatMap(([key, item]) => item === undefined || item === "" ? [] : [[key, item]])));
    setInvalid(!parsed.success);
    if (parsed.success) onChange(parsed.data);
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <input className="field w-full sm:w-72" aria-label={t("Filter documents", "Filtrar documentos")} value={query} maxLength={500}
        onChange={(event) => { setQuery(event.target.value); onChange({ ...value, q: event.target.value.trim() || undefined }); }}
        placeholder={t("Find a document…", "Encontrar um documento…")} />
      {active && <button type="button" className="text-action min-h-11" onClick={() => { setDraft({}); setQuery(""); setInvalid(false); onChange({}); }}>{t("Clear filters", "Limpar filtros")}</button>}
    </div>
    <details className="border-b border-slate-800 pb-3">
      <summary className="min-h-11 w-fit rounded-md py-3 text-sm text-slate-300">{t("Advanced filters", "Filtros avançados")}{count > 0 ? ` · ${count}` : ""}</summary>
      <form className="mt-3 space-y-4" onSubmit={submit}>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SelectField label={t("Document", "Documento")} value={draft.documentId ?? "all"}
            onValueChange={(id) => update("documentId", id === "all" ? undefined : id)}
            options={[{ value: "all", label: t("All documents", "Todos os documentos") }, ...documents.map(({ id, title, source }) => ({ value: id, label: title ?? source }))]} />
          <label className="grid min-w-0 gap-2 text-xs font-medium text-slate-300">{t("Source contains", "A fonte contém")}
            <input className="field" value={draft.source ?? ""} maxLength={1_000} placeholder="demo/support/" onChange={(event) => update("source", event.target.value)} />
          </label>
          <SelectField label={t("Language", "Idioma")} value={draft.language ?? "all"} onValueChange={(language) => update("language", language === "all" ? undefined : language as Filters["language"])}
            options={[{ value: "all", label: t("All languages", "Todos os idiomas") }, { value: "en", label: t("English", "Inglês") }, { value: "pt", label: t("Portuguese", "Português") }, { value: "mixed", label: t("Mixed languages", "Idiomas mistos") }, { value: "und", label: t("Undetermined", "Não identificado") }]} />
          <SelectField label={t("File type", "Tipo de arquivo")} value={draft.format ?? "all"} onValueChange={(format) => update("format", format === "all" ? undefined : format as Filters["format"])}
            options={[{ value: "all", label: t("All file types", "Todos os tipos") }, ...["pdf", "docx", "html", "markdown", "text"].map((format) => ({ value: format, label: format === "text" ? t("Plain text", "Texto simples") : format === "markdown" ? "Markdown" : format.toUpperCase() }))]} />
          <label className="grid min-w-0 gap-2 text-xs font-medium text-slate-300">{t("Updated from", "Atualizado a partir de")}
            <input type="date" className="field min-w-0 [color-scheme:dark]" value={draft.from ?? ""} onChange={(event) => update("from", event.target.value || undefined)} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} />
          </label>
          <label className="grid min-w-0 gap-2 text-xs font-medium text-slate-300">{t("Updated through", "Atualizado até")}
            <input type="date" className="field min-w-0 [color-scheme:dark]" value={draft.to ?? ""} onChange={(event) => update("to", event.target.value || undefined)} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} />
          </label>
        </div>
        <p className="text-xs text-slate-400">{t("Dates include the whole UTC day. Filters search this workspace’s library on the server; up to 100 matches are shown.", "As datas incluem o dia completo em UTC. Os filtros buscam no acervo deste espaço no servidor; até 100 resultados são exibidos.")}</p>
        {invalid && <p className="error-message" id={errorId} role="alert">{t("Check the filter dates. The end date must be on or after the start date.", "Confira as datas. A data final deve ser igual ou posterior à inicial.")}</p>}
        <button type="submit" className="secondary-button">{t("Apply filters", "Aplicar filtros")}</button>
      </form>
    </details>
  </div>;
}
