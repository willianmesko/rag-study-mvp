import type { QuestionResponse, QuestionSource } from "../api/rag-api";
import { useLocale } from "../i18n/locale";
import { ExcerptDisclosure } from "./SourcePreview";

function EvidenceList({ passages, showSimilarity }: { passages: QuestionSource[]; showSimilarity: boolean }) {
  const { t, locale } = useLocale();
  const format = new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  return <ul className="mt-3 grid gap-3">
    {passages.map((passage) => <li key={passage.chunkId} className="rounded-xl border border-slate-800 bg-slate-950/45 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-slate-100">{passage.title ?? passage.source}</p>
          <p className="mt-1 text-xs text-slate-400">{t("Passage", "Trecho")} {(passage.chunk + 1).toLocaleString(locale)}</p>
        </div>
        {showSimilarity && Number.isFinite(passage.score) && <p className="font-mono text-xs text-cyan-300">{t("Cosine similarity", "Similaridade cosseno")} {format.format(passage.score)}</p>}
      </div>
      {passage.excerpt && <ExcerptDisclosure excerpt={passage.excerpt} truncated={passage.excerptTruncated} />}
    </li>)}
  </ul>;
}

export function RagEvidencePanel({ response, citations }: { response: QuestionResponse; citations: QuestionSource[] }) {
  const { t, locale } = useLocale();
  const context = response.cacheHit ? [] : response.contextSources ?? [];
  const other = response.cacheHit ? response.sources : response.contextSources === undefined
    ? response.sources.filter((source) => !citations.some((citation) => citation.chunkId === source.chunkId)) : [];
  if (citations.length === 0 && context.length === 0 && other.length === 0) return null;

  const count = (value: number) => `${value.toLocaleString(locale)} ${value === 1 ? t("passage", "trecho") : t("passages", "trechos")}`;

  return (
    <section className="panel animate-fade-up space-y-5 border-violet-400/20 bg-violet-400/[0.04]" aria-label={t("Document evidence", "Trechos dos documentos")}>
      <div>
        <p className="eyebrow text-violet-300">{t("Document evidence", "Trechos dos documentos")}</p>
        <h3 className="mt-2 text-lg font-semibold text-white">{response.cacheHit ? t("Evidence saved with this answer", "Trechos salvos com esta resposta")
          : response.contextSources === undefined ? t("Review the available passages", "Confira os trechos disponíveis")
          : t("How this answer used your documents", "Como a resposta usou seus documentos")}</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          {response.cacheHit ? t("These passages came with the earlier answer that Lumora reused.", "Estes trechos vieram da resposta anterior que o Lumora reutilizou.")
            : t("A document can be split into several passages. Open a passage to review its excerpt.", "Um documento pode ser dividido em vários trechos. Abra um trecho para ler a prévia.")}
        </p>
      </div>
      {citations.length > 0 && <div>
        <h4 className="text-sm font-semibold text-slate-100">{t("Validated citations", "Citações validadas")} · {count(citations.length)}</h4>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          {t("Lumora checked that the references point to the passages below. Read the excerpts to verify what they support.", "O Lumora conferiu se as referências apontam para os trechos abaixo. Leia as prévias para verificar o que sustentam.")}
        </p>
        <EvidenceList passages={citations} showSimilarity />
      </div>}
      {context.length > 0 && <details className="rounded-xl border border-slate-800 px-4 py-3">
        <summary className="cursor-pointer rounded-md text-sm font-semibold text-slate-100">
          {t("Passages sent to the model", "Trechos enviados ao modelo")} · {count(context.length)}
        </summary>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          {t("The model received these passages while drafting the answer. Cited passages can also appear here.", "O modelo recebeu estes trechos para elaborar a resposta. Trechos citados também podem aparecer aqui.")}
        </p>
        <EvidenceList passages={context} showSimilarity />
      </details>}
      {other.length > 0 && <div>
        <h4 className="text-sm font-semibold text-slate-100">
          {response.cacheHit ? t("Saved passages", "Trechos salvos") : t("Available passages", "Trechos disponíveis")} · {count(other.length)}
        </h4>
        <EvidenceList passages={other} showSimilarity={!response.cacheHit} />
      </div>}
      {!response.cacheHit && <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-xs leading-5 text-amber-100">
        {t("Cosine similarity ranges from −1 to 1. Higher values indicate a closer match in meaning. A close match can still contain an error. Check the passage before relying on a claim.", "A similaridade cosseno vai de −1 a 1. Valores mais altos indicam maior proximidade de significado. Mesmo um trecho muito semelhante pode conter um erro. Leia a fonte antes de confiar na afirmação.")}
      </p>}
    </section>
  );
}
