import type { QuestionSource } from "../api/rag-api";
import { useLocale } from "../i18n/locale";

export function RagEvidencePanel({ sources, onInspectSource }: { sources: QuestionSource[]; onInspectSource: (source: QuestionSource) => void }) {
  const { t, locale } = useLocale();
  if (sources.length === 0) return null;
  const format = new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  return (
    <section className="panel animate-fade-up border-violet-400/20 bg-violet-400/[0.04]" aria-label={t("Answer sources", "Fontes da resposta")}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow text-violet-300">{t("Sources", "Fontes")}</p>
          <h3 className="mt-2 text-lg font-semibold text-white">{t("Passages found in your documents", "Trechos encontrados nos documentos")}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{t("Review the passages Lumora found for this question.", "Confira os trechos que o Lumora encontrou para esta pergunta.")}</p>
        </div>
        <span className="status-pill">{sources.length} {sources.length === 1 ? t("passage", "trecho") : t("passages", "trechos")}</span>
      </div>
      <div className="mt-5 grid gap-3">
        {sources.map((source, index) => {
          const score = Math.max(0, Math.min(1, source.score));
          return (
            <article key={source.chunkId} className="rounded-xl border border-slate-800 bg-slate-950/45 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words font-mono text-xs text-violet-300">{t("Source", "Fonte")} {index + 1} · {source.title ?? source.source}</p>
                  <p className="mt-1 text-xs text-slate-400">{t("Passage", "Trecho")} {source.chunk}</p>
                </div>
                <p className="font-mono text-xs font-semibold text-cyan-300">{t("Similarity", "Similaridade")} {format.format(score)}</p>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
                <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-300" style={{ width: `${score * 100}%` }} />
              </div>
              <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-slate-300">{source.excerpt}</p>
              <button type="button" className="secondary-button mt-3 min-h-9 px-3 py-1.5 text-xs" onClick={() => onInspectSource(source)}>
                {t("Read excerpt", "Ler trecho")}
              </button>
            </article>
          );
        })}
      </div>
      <p className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-xs leading-5 text-amber-100">
        {t("Similarity measures how closely a passage matches the question. Read the source to verify the facts.",
           "Similaridade mede o quanto um trecho se aproxima da pergunta. Leia a fonte para verificar os fatos.")}
      </p>
    </section>
  );
}
