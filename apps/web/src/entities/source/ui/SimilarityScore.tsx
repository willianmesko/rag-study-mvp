import { useLocale } from "../../../shared/i18n/locale";

/** A retrieval score is a meaning match, never a factual-confidence percentage. */
export function SimilarityScore({ score, stacked = false }: { score: number; stacked?: boolean }) {
  const { t, locale } = useLocale();
  const value = Number.isFinite(score)
    ? score.toLocaleString(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "–";
  const label = t("Cosine similarity", "Similaridade cosseno");
  return stacked ? <dl>
    <dt className="text-[10px] uppercase tracking-wider text-slate-400">{label}</dt>
    <dd className="mt-1 font-mono text-sm font-semibold text-cyan-300">{value}</dd>
  </dl> : <p className="font-mono text-xs text-cyan-300">{label} {value}</p>;
}
