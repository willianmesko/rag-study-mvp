import type { QuestionSource } from "../api/rag-api";
import { useLocale } from "../i18n/locale";

export function SourcePreview({ source, onClose }: { source: QuestionSource; onClose: () => void }) {
  const { t } = useLocale();
  return (
    <section className="panel animate-fade-up mt-6 border-violet-400/20 bg-violet-400/[0.05]" aria-label={t("Cited source", "Fonte citada")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow text-violet-300">{t("Cited source", "Fonte citada")}</p>
          <p className="mt-2 break-words text-sm font-medium text-slate-100">{source.title ?? source.source} · {t("passage", "trecho")} {source.chunk}</p>
        </div>
        <button type="button" className="secondary-button min-h-8 px-3 py-1 text-xs" onClick={onClose}>{t("Close", "Fechar")}</button>
      </div>
      <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{source.excerpt}</p>
    </section>
  );
}
