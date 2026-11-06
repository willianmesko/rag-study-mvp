import type { SearchResult } from "../api/rag-api";
import { useLocale } from "../i18n/locale";

export function SearchResultCard({ result, index }: { result: SearchResult; index: number }) {
  const { t, locale } = useLocale();
  const risk = result.security.promptInjectionRisk;
  const riskStyle = { high: "text-rose-300", medium: "text-amber-300", low: "text-emerald-300" };
  const riskLabel = { high: t("High", "Alto"), medium: t("Medium", "Médio"), low: t("Low", "Baixo") };
  const score = Math.max(0, Math.min(1, result.score));
  const format = (value: number, digits = 3) => value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });

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
              <p className="mt-1 break-words font-mono text-xs text-slate-400">{result.source} · {t("passage", "trecho")} {result.ordinal}</p>
              <p className={`mt-1 text-xs font-medium ${riskStyle[risk]}`}>{t("Instruction risk", "Risco de instruções")} · {riskLabel[risk]}</p>
              {result.retrieval && <p className="mt-1 font-mono text-xs text-slate-400">
                RRF {format(result.retrieval.fusionScore, 4)} · {t("vector", "vetor")} #{result.retrieval.vectorRank ?? "–"} · {t("keyword", "palavra-chave")} #{result.retrieval.keywordRank ?? "–"}
              </p>}
              {result.reranker && <p className="mt-1 font-mono text-xs text-violet-300">
                {t("Reranking", "Reordenação")} #{result.reranker.rank} · {t("relevance", "relevância")} {format(result.reranker.score)}
              </p>}
            </div>
            <div className="flex min-w-28 flex-col items-end gap-1" title={t("Similarity measures how closely the passage matches your search.", "A similaridade mede a proximidade entre o trecho e sua busca.")}>
              <span className="font-mono text-sm font-semibold text-cyan-300">{format(score)}</span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
                <div className="h-full rounded-full bg-cyan-400" style={{ width: `${score * 100}%` }} />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-400">{t("Similarity", "Similaridade")}</span>
            </div>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{result.content}</p>
        </div>
      </div>
    </article>
  );
}
