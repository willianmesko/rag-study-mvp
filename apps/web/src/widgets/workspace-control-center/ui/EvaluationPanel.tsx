import type { ReactNode } from "react";
import { z } from "zod";
import type { EvaluationRun } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";

const qualityDetailsSchema = z.object({
  contextPrecision: z.object({ method: z.literal("reviewed-passage-ap"), version: z.string(), scoredCases: z.number() }),
  faithfulness: z.object({
    method: z.literal("public-claim-evidence-judge"), version: z.string(),
    status: z.enum(["not_requested", "unavailable", "calibration_failed", "incomplete", "completed"]),
    judgeModel: z.string().nullable(), scoredCases: z.number(), totalCases: z.number()
  })
});

function metricTone(value: number | null, threshold: number) {
  if (value === null) return "text-slate-400";
  return value >= threshold ? "text-emerald-300" : "text-rose-300";
}

export function EvaluationPanel({ runs, isLoading, isRunning, canRun, onRun, runOptions }: {
  runs: EvaluationRun[]; isLoading: boolean; isRunning: boolean; canRun: boolean; onRun: () => void; runOptions?: ReactNode;
}) {
  const { locale, t } = useLocale();
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: "percent" });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const percentage = (value: number | null) => value === null ? t("Unavailable", "Indisponível") : percent.format(value);
  const result = (passed: boolean) => passed ? t("Passed", "Aprovado") : t("Failed", "Falhou");
  const latest = runs[0];
  const quality = qualityDetailsSchema.safeParse(latest?.failureDetails.quality).data;
  const judgeStatus = {
    not_requested: t("Optional judge not requested", "Avaliador opcional não solicitado"),
    unavailable: t("Optional judge not configured", "Avaliador opcional não configurado"),
    calibration_failed: t("Judge calibration did not pass", "O avaliador não passou na calibração"),
    incomplete: t("Some public cases could not be scored", "Alguns casos públicos não puderam ser avaliados"),
    completed: t("Public cases scored", "Casos públicos avaliados")
  };
  const columns = [
    t("Run", "Execução"), t("Hit rate", "Taxa de acerto"), "MRR",
    t("Injection defense", "Defesa contra injeção"), t("Faithfulness", "Fidelidade"), t("Context precision", "Precisão do contexto"), t("Status", "Status")
  ];

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t("Evaluation suite", "Suíte de avaliação")}</p>
          <h3 className="mt-2 font-medium">{t("RAG quality dashboard", "Painel de qualidade das respostas")}</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">
            {t("Run the reference tests for this workspace. Context precision checks the rank of reviewed passages. The optional judge measures faithfulness on separate public cases.", "Execute os testes de referência deste espaço. A precisão do contexto verifica a ordem dos trechos revisados. O avaliador opcional mede a fidelidade em casos públicos separados.")}
          </p>
        </div>
        <button className="primary-button" type="button" onClick={onRun} disabled={isRunning || isLoading || !canRun}>{isRunning ? t("Running…", "Avaliando…") : t("Run evaluation", "Executar avaliação")}</button>
      </div>
      {runOptions}
      {isLoading && <div className="mt-5 grid gap-3 sm:grid-cols-3" role="status" aria-label={t("Loading evaluations", "Carregando avaliações")}><div className="skeleton h-20" /><div className="skeleton h-20" /><div className="skeleton h-20" /></div>}
      {!isLoading && latest && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Metric label={t("Hit rate", "Taxa de acerto")} value={percentage(latest.hitRate)} tone={metricTone(latest.hitRate, 0.8)} />
            <Metric label="MRR" value={percentage(latest.meanReciprocalRank)} tone={metricTone(latest.meanReciprocalRank, 0.7)} />
            <Metric label={t("Faithfulness", "Fidelidade")} value={percentage(latest.faithfulness)} tone="text-slate-400" />
            <Metric label={t("Context precision", "Precisão do contexto")} value={percentage(latest.contextPrecision)} tone="text-slate-400" />
            <Metric label={t("Injection defense", "Defesa contra injeção")} value={percentage(latest.injectionPassRate)} tone={metricTone(latest.injectionPassRate, 1)} />
          </div>
          {quality && <div className="mt-4 grid gap-2 text-xs text-slate-400">
            <p>{t("Context precision", "Precisão do contexto")} · {t("Reviewed passages", "Trechos revisados")} v{quality.contextPrecision.version} · {quality.contextPrecision.scoredCases}/{latest.totalCases} {t("cases", "casos")}</p>
            <p>{t("Faithfulness", "Fidelidade")} · {judgeStatus[quality.faithfulness.status]} · {quality.faithfulness.scoredCases}/{quality.faithfulness.totalCases} {t("public cases", "casos públicos")}
              {quality.faithfulness.judgeModel && quality.faithfulness.status !== "not_requested" && <> · {t("Judge", "Avaliador")} <span className="font-mono">{quality.faithfulness.judgeModel}</span> · {t("Answer model", "Modelo de resposta")} <span className="font-mono">{latest.chatModel}</span></>}
            </p>
          </div>}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span className={"status-pill " + (latest.passed ? "status-pill--success" : "border-rose-400/30 bg-rose-400/10 text-rose-300")}>{result(latest.passed)}</span>
            <span>{latest.datasetName} v{latest.datasetVersion}</span>
            <span>{number.format(latest.totalCases)} {latest.totalCases === 1 ? t("case", "caso") : t("cases", "casos")}</span>
            <span>{number.format(latest.durationMs)} ms</span>
            <span>{date.format(new Date(latest.createdAt))}</span>
          </div>
        </>
      )}
      {!isLoading && runs.length === 0 && (
        <p className="empty-state mt-5">
          {t("No evaluation runs yet. Upload the reference material using the source ID", "Ainda não há avaliações. Envie o material de referência com o identificador de fonte")}{" "}
          <span className="font-mono">golden/rag-fundamentals</span>{" "}
          {t("before running the retrieval evaluation.", "antes de executar os testes de busca.")}
        </p>
      )}
      {!isLoading && runs.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="border-b border-slate-800 text-slate-400">
              <tr>{columns.map((column) => <th key={column} scope="col" className="px-3 py-2 font-medium">{column}</th>)}</tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr className="border-b border-slate-900" key={run.id}>
                  <td className="px-3 py-3">
                    <p className="text-slate-300">{date.format(new Date(run.createdAt))}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-400">{run.commitSha?.slice(0, 7) ?? t("local", "local")}</p>
                  </td>
                  <td className={"px-3 py-3 font-mono " + metricTone(run.hitRate, 0.8)}>{percentage(run.hitRate)}</td>
                  <td className={"px-3 py-3 font-mono " + metricTone(run.meanReciprocalRank, 0.7)}>{percentage(run.meanReciprocalRank)}</td>
                  <td className={"px-3 py-3 font-mono " + metricTone(run.injectionPassRate, 1)}>{percentage(run.injectionPassRate)}</td>
                  <td className="px-3 py-3 text-slate-400">{percentage(run.faithfulness)}</td>
                  <td className="px-3 py-3 text-slate-400">{percentage(run.contextPrecision)}</td>
                  <td className={"px-3 py-3 " + (run.passed ? "text-emerald-300" : "text-rose-300")}>{result(run.passed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={"mt-2 font-mono text-lg " + tone}>{value}</p>
    </div>
  );
}
