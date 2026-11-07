import { useState } from "react";
import type { QuestionSource } from "../api/rag-api";
import { useLocale } from "../i18n/locale";

function ExcerptText({ excerpt, truncated }: { excerpt: string; truncated?: boolean }) {
  const { t } = useLocale();
  return <>
    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{excerpt}</p>
    {truncated && <p className="mt-2 text-xs text-slate-400">
      {t("This preview shows the beginning of the passage.", "Esta prévia mostra o início do trecho.")}
    </p>}
  </>;
}

export function ExcerptDisclosure({ excerpt, truncated }: { excerpt: string; truncated?: boolean }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <details className="mt-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="w-fit cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-cyan-300 hover:text-cyan-100">
        {open ? t("Hide excerpt", "Ocultar trecho") : t("Read excerpt", "Ler trecho")}
      </summary>
      {open && <ExcerptText excerpt={excerpt} truncated={truncated} />}
    </details>
  );
}

export function SourcePreview({ source, onClose }: { source: QuestionSource; onClose: () => void }) {
  const { t, locale } = useLocale();
  return (
    <section className="panel animate-fade-up mt-6 border-violet-400/20 bg-violet-400/[0.05]" aria-label={t("Saved excerpt", "Trecho salvo")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow text-violet-300">{t("Saved excerpt", "Trecho salvo")}</p>
          <p className="mt-2 break-words text-sm font-medium text-slate-100">{source.title ?? source.source} · {t("passage", "trecho")} {(source.chunk + 1).toLocaleString(locale)}</p>
        </div>
        <button type="button" className="secondary-button min-h-8 px-3 py-1 text-xs" onClick={onClose}>{t("Close", "Fechar")}</button>
      </div>
      <ExcerptText excerpt={source.excerpt} truncated={source.excerptTruncated} />
    </section>
  );
}
