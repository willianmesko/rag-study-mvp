import type { QuestionHistoryEntry } from "../../../entities/question/model/history";
import type { QuestionSource } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { SectionTitle } from "../../../shared/ui/SectionTitle";

export function QuestionHistoryPanel({ history, onClear, onFeedback, onInspectSource }: { history: QuestionHistoryEntry[]; onClear: () => void; onFeedback: (id: string, feedback: "up" | "down") => void; onInspectSource: (source: QuestionSource) => void }) {
  const { t, locale } = useLocale();
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const feedbackActions = [
    { id: "up", label: t("👍 Helpful", "👍 Útil"), active: "bg-emerald-500/20 text-emerald-200" },
    { id: "down", label: t("👎 Needs work", "👎 Precisa melhorar"), active: "bg-rose-500/20 text-rose-200" }
  ] as const;

  return (
    <section className="space-y-6">
      <SectionTitle eyebrow={t("Your activity", "Sua atividade")} title={t("Recent answers", "Respostas recentes")}>
        {t("Recent questions are saved on this device. Rate an answer to mark it for review.", "As perguntas recentes ficam neste dispositivo. Avalie uma resposta para sinalizar se ela merece revisão.")}
      </SectionTitle>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-slate-400">{history.length.toLocaleString(locale)} {history.length === 1 ? t("recent question", "pergunta recente") : t("recent questions", "perguntas recentes")}</p>
        {history.length > 0 && <button type="button" className="text-sm text-rose-300 hover:text-rose-100" onClick={onClear}>{t("Clear history", "Limpar histórico")}</button>}
      </div>
      {history.length === 0 && <p className="empty-state">{t("Ask Lumora a question to see your recent answers here.", "Faça uma pergunta ao Lumora para ver suas respostas recentes aqui.")}</p>}
      <div className="grid gap-4">
        {history.map((entry) => (
          <article key={entry.id} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-sm font-medium text-slate-100">{entry.question}</p>
              <time className="font-mono text-[11px] text-slate-400" dateTime={entry.createdAt}>{dateFormat.format(new Date(entry.createdAt))}</time>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-300">{entry.answer}</p>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
              <div className="flex gap-2">
                {feedbackActions.map(({ id, label, active }) => <button key={id} type="button" aria-pressed={entry.feedback === id}
                  className={`rounded-md px-3 py-1.5 text-xs ${entry.feedback === id ? active : "bg-slate-800 text-slate-300 hover:text-white"}`}
                  onClick={() => onFeedback(entry.id, id)}>{label}</button>)}
              </div>
              <div className="flex max-w-full gap-2 overflow-x-auto">
                {entry.sources.map((source, index) => <button type="button" key={source.chunkId} onClick={() => onInspectSource(source)}
                  className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-cyan-300 hover:border-cyan-400/50">{t("Source", "Fonte")} {index + 1}</button>)}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
