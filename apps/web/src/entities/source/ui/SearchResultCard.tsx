import type { SearchResult } from "@rag-study/contracts";
import { useLocale } from "../../../shared/i18n/locale";
import { SimilarityScore } from "./SimilarityScore";
import { ExcerptDisclosure } from "./SourcePreview";

export function SearchResultCard({ result, index }: { result: SearchResult; index: number }) {
  const { t, locale } = useLocale();
  const risk = result.security.promptInjectionRisk;
  const riskStyle = { high: "text-rose-300", medium: "text-amber-300", low: "text-emerald-300" };
  const riskLabel = { high: t("High", "Alto"), medium: t("Medium", "Médio"), low: t("Low", "Baixo") };
  const blocked = result.previewBlocked || risk === "high";
  const hasPreview = result.content && (result.previewTruncated !== undefined || result.previewBlocked !== undefined);
  const format = (value: number, digits = 3) => Number.isFinite(value)
    ? value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "–";

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
      <div className="flex gap-4">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-xl bg-cyan-400/10 font-mono text-xs font-semibold text-cyan-300">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium text-slate-100">{result.title ?? result.source}</p>
              <p className="mt-1 break-words font-mono text-xs text-slate-400">{result.source} · {t("passage", "trecho")} {(result.ordinal + 1).toLocaleString(locale)}</p>
              <p className={`mt-1 text-xs font-medium ${riskStyle[risk]}`}>{t("Instruction risk", "Risco de instruções")} · {riskLabel[risk]}</p>
              {result.retrieval && <p className="mt-1 font-mono text-xs text-slate-400">
                RRF {format(result.retrieval.fusionScore, 4)} · {t("Vector rank", "Posição vetorial")} {result.retrieval.vectorRank ?? "–"} · {t("Keyword rank", "Posição textual")} {result.retrieval.keywordRank ?? "–"}
              </p>}
              {result.reranker && <p className="mt-1 font-mono text-xs text-violet-300">
                {t("Reranker rank", "Posição após reordenação")} {result.reranker.rank} · {t("Relevance", "Relevância")} {format(result.reranker.score)}
              </p>}
            </div>
            <SimilarityScore score={result.score} stacked />
          </div>
          {blocked ? <p className="text-xs text-amber-200">
            {t("Preview withheld because this passage may contain unsafe instructions.", "Prévia ocultada porque o trecho pode conter instruções perigosas.")}
          </p> : hasPreview ? <ExcerptDisclosure excerpt={result.content} truncated={result.previewTruncated} />
            : <p className="text-xs text-slate-400">{t("Preview unavailable for this result.", "Prévia indisponível para este resultado.")}</p>}
        </div>
      </div>
    </article>
  );
}
