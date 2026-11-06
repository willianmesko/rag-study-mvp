import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { searchInputSchema } from "@rag-study/contracts";
import { api } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";
import { InputLabel } from "../../../shared/ui/InputLabel";
import { SearchResultCard } from "../../../shared/ui/SearchResultCard";
import { SelectField } from "../../../shared/ui/SelectField";
import { SectionTitle } from "../../../shared/ui/SectionTitle";

export function SemanticSearchForm({ accessToken, workspaceId, workspaceName }: { accessToken?: string | null; workspaceId?: string; workspaceName?: string }) {
  const { t, locale } = useLocale();
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [invalidInput, setInvalidInput] = useState(false);
  const search = useMutation({ mutationFn: api.search });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = searchInputSchema.safeParse({ query: query.trim(), topK });
    setInvalidInput(!input.success);
    if (input.success) search.mutate({ ...input.data, accessToken: accessToken ?? undefined, workspaceId });
  }

  const results = search.data?.results;
  const error = invalidInput ? t("Enter a search of up to 5,000 characters.", "Digite uma busca de até 5.000 caracteres.")
    : search.error ? getRequestErrorMessage(search.error, locale) : null;

  return (
    <form className="space-y-7" onSubmit={submit} aria-busy={search.isPending}>
      <SectionTitle eyebrow={t("Find knowledge", "Encontre informações")} title={t("Search your workspace", "Busque no seu espaço de trabalho")}>
        {t("Lumora finds relevant passages by meaning and exact terms.", "O Lumora encontra trechos relevantes pelo significado e pelos termos exatos.")}
      </SectionTitle>
      <div className="panel space-y-5">
        <div className="workspace-context">
          <span className="workspace-context__dot" aria-hidden="true" />
          <div>
            <p className="eyebrow">{t("Searching in", "Buscando em")}</p>
            <p className="mt-1 text-sm font-medium text-slate-100">{workspaceName ?? t("Demo workspace", "Espaço de demonstração")}</p>
          </div>
        </div>
        <InputLabel label={t("What are you looking for?", "O que você está procurando?")}>
          <textarea aria-describedby="search-hint" value={query} maxLength={5000} onChange={(event) => setQuery(event.target.value)} className="field min-h-32 resize-y"
            placeholder={t("How do embeddings represent meaning?", "Como os embeddings representam o significado?")} />
          <span id="search-hint" className="text-xs font-normal text-slate-400">{t("Use your own words or enter a term from a document.", "Use suas próprias palavras ou digite um termo de um documento.")}</span>
        </InputLabel>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <SelectField className="w-44" label={t("Results to show", "Resultados para mostrar")}
            value={String(topK)} onValueChange={(value) => setTopK(Number(value))}
            options={["3", "5", "8", "10"].map((value) => ({ value, label: value }))} />
          <button className="primary-button" disabled={search.isPending || query.trim().length === 0} type="submit">
            {search.isPending && <span className="spinner" aria-hidden="true" />}
            {search.isPending ? t("Searching…", "Buscando…") : t("Search", "Buscar")}
          </button>
        </div>
      </div>
      {search.isPending && <div className="grid gap-3" role="status" aria-label={t("Loading search results", "Carregando resultados")}><div className="skeleton h-28" /><div className="skeleton h-28" /></div>}
      {results && (
        <div className="space-y-3 animate-fade-up">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-slate-400">{results.length.toLocaleString(locale)} {results.length === 1 ? t("result", "resultado") : t("results", "resultados")}</p>
            <span className="status-pill">{t("Meaning + exact terms", "Significado + termos exatos")}</span>
          </div>
          {results.length === 0 ? <p className="empty-state">{t("No close matches yet. Try a broader phrase or add another source.", "Nenhum resultado próximo. Tente uma busca mais ampla ou adicione outra fonte.")}</p>
            : results.map((result, index) => <SearchResultCard key={result.chunkId} result={result} index={index} />)}
        </div>
      )}
      {error && !search.isPending && <p role="alert" className="error-message">{error}</p>}
    </form>
  );
}
