import type { ReactNode } from "react";
import type { EvaluationRun } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { compareRecordedEfforts, effortLabels, evaluationMeasurementExport, readEvaluationQuality } from "../model/evaluation-quality";

function metricTone(value: number | null, threshold: number) {
  if (value === null) return "text-slate-400";
  return value >= threshold ? "text-slate-100" : "text-rose-200";
}

function downloadMeasurements(data: NonNullable<ReturnType<typeof evaluationMeasurementExport>>) {
  const file = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lumora-evaluation-${data.failureDetails.quality.faithfulness.effort}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function EvaluationPanel({ runs, isLoading, runOptions }: {
  runs: EvaluationRun[]; isLoading: boolean; runOptions?: ReactNode;
}) {
  const { locale, t } = useLocale();
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: "percent" });
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 6 });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const percentage = (value: number | null) => value === null ? t("Unavailable", "Indisponível") : percent.format(value);
  const result = (passed: boolean) => passed ? t("Passed", "Aprovado") : t("Failed", "Falhou");
  const latest = runs[0];
  const quality = readEvaluationQuality(latest);
  const comparison = compareRecordedEfforts(runs);
  const comparableCost = comparison && comparison[0].meanCostUsd !== null && comparison[1].meanCostUsd !== null
    && comparison[0].costSource === comparison[1].costSource;
  const judgeStatus = {
    not_requested: t("Optional judge not requested", "Avaliador opcional não solicitado"),
    unavailable: t("Optional judge not configured", "Avaliador opcional não configurado"),
    calibration_failed: t("Judge calibration did not pass", "O avaliador não passou na calibração"),
    incomplete: t("Some public cases could not be scored", "Alguns casos públicos não puderam ser avaliados"),
    completed: t("Public cases scored", "Casos públicos avaliados")
  };
  const columns = [
    t("Run", "Execução"), t("Hit rate", "Taxa de acerto"), "MRR",
    t("Injection defense", "Defesa contra injeção"), t("Faithfulness", "Fidelidade"), t("Context precision", "Precisão do contexto"), t("Retrieval and safety", "Busca e segurança")
  ];

  return (
    <section className="space-y-4">
      <details className="text-sm text-slate-400">
        <summary className="min-h-11 rounded-lg py-2">{t("How to read the results", "Como interpretar os resultados")}</summary>
          <p className="mt-1 max-w-2xl text-xs leading-5">
            {t("Workspace retrieval checks whether the expected reference passages were found and ranked. Public faithfulness and judge calibration use separate bundled examples. Counts such as 4/4 describe cases scored; they are not the number of correct answers. The final result covers retrieval and deterministic injection screening.", "A busca do espaço confere se os trechos de referência esperados foram encontrados e ordenados. Fidelidade em casos públicos e calibração usam exemplos separados do projeto. Contagens como 4/4 indicam casos avaliados, não respostas corretas. O resultado final cobre busca e triagem determinística de injeção.")}
          </p>
      </details>
      {runOptions}
      {isLoading && <div className="mt-5 grid gap-3 sm:grid-cols-3" role="status" aria-label={t("Loading evaluations", "Carregando avaliações")}><div className="skeleton h-20" /><div className="skeleton h-20" /><div className="skeleton h-20" /></div>}
      {!isLoading && latest && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-5 border-y border-slate-800 py-5 sm:grid-cols-3 lg:grid-cols-5">
            <Metric label={t("Hit rate", "Taxa de acerto")} value={percentage(latest.hitRate)} tone={metricTone(latest.hitRate, 0.8)} />
            <Metric label="MRR" value={percentage(latest.meanReciprocalRank)} tone={metricTone(latest.meanReciprocalRank, 0.7)} />
            <Metric label={t("Faithfulness · public examples", "Fidelidade · exemplos públicos")} value={percentage(latest.faithfulness)} tone="text-slate-400" />
            <Metric label={t("Context precision", "Precisão do contexto")} value={percentage(latest.contextPrecision)} tone="text-slate-400" />
            <Metric label={t("Injection screening", "Triagem de injeção")} value={percentage(latest.injectionPassRate)} tone={metricTone(latest.injectionPassRate, 1)} />
          </div>
          {quality && <div className="mt-4 grid gap-2 text-xs text-slate-400">
            <p>{t("Context precision", "Precisão do contexto")} · {t("Reviewed passages", "Trechos revisados")} v{quality.contextPrecision.version} · {quality.contextPrecision.scoredCases}/{latest.totalCases} {t("cases scored", "casos avaliados")}</p>
            <p>{t("Faithfulness", "Fidelidade")} · {judgeStatus[quality.faithfulness.status]} · {quality.faithfulness.scoredCases}/{quality.faithfulness.totalCases} {t("public cases scored", "casos públicos avaliados")}
              {quality.faithfulness.judgeModel && quality.faithfulness.status !== "not_requested" && <> · {t("Judge", "Avaliador")} <span className="font-mono">{quality.faithfulness.judgeModel}</span> · {t("Answer model", "Modelo de resposta")} <span className="font-mono">{latest.chatModel}</span></>}
            </p>
            {quality.faithfulness.effort && quality.faithfulness.maxOutputTokens && <p>
              {t("Answer effort", "Esforço da resposta")} · {t(...effortLabels[quality.faithfulness.effort])} · {number.format(quality.faithfulness.maxOutputTokens)} {t("token cap", "tokens no máximo")}
            </p>}
            {quality.faithfulness.calibration && <p>
              {t("Judge calibration", "Calibração do avaliador")} v{quality.faithfulness.calibration.version} · {quality.faithfulness.calibration.matchedClaims}/{quality.faithfulness.calibration.expectedClaims} {t("claims", "afirmações")} · {t("agreement", "concordância")} {percentage(quality.faithfulness.calibration.agreement)} · {t("false positives", "falsos positivos")} {percentage(quality.faithfulness.calibration.falsePositiveRate)} · {t("false negatives", "falsos negativos")} {percentage(quality.faithfulness.calibration.falseNegativeRate)}
            </p>}
          </div>}
          {latest.hitRate === 0 && latest.meanReciprocalRank === 0 && <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-4 text-sm leading-6 text-amber-100" role="status">
            {t("None of this run’s retrieval questions found an expected source. Check that the benchmark’s reference material is prepared in this workspace. A high faithfulness score on the separate public examples does not change this retrieval result.",
              "Nenhuma pergunta de busca desta execução encontrou uma fonte esperada. Confira se o material do benchmark está pronto neste espaço. A fidelidade alta nos exemplos públicos separados não altera esse resultado de busca.")}
          </p>}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span className={"status-pill " + (latest.passed ? "" : "border-rose-400/30 bg-rose-400/10 text-rose-200")}>{result(latest.passed)}</span>
            <span>{latest.datasetName} v{latest.datasetVersion}</span>
            <span>{number.format(latest.totalCases)} {latest.totalCases === 1 ? t("case", "caso") : t("cases", "casos")}</span>
            <span>{number.format(latest.durationMs)} ms</span>
            <span>{date.format(new Date(latest.createdAt))}</span>
          </div>
        </>
      )}
      {!isLoading && comparison && <section className="mt-6 rounded-xl border border-slate-700 p-4" aria-label={t("Answer effort comparison", "Comparação de esforço da resposta")}>
        <h4 className="font-semibold text-slate-100">{t("Compare answer effort", "Comparar esforço da resposta")}</h4>
        <p className="mt-1 text-xs text-slate-400">{comparison[0].model} · {t("Same public cases and prompt. Timing and cost cover answer generation.", "Mesmos casos públicos e prompt. O tempo e o custo cobrem a geração da resposta.")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {comparison.map((item) => <div key={item.effort} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-200">
            <p className="font-medium">{t(...effortLabels[item.effort])} · {number.format(item.maxOutputTokens)} {t("tokens max", "tokens no máximo")}</p>
            <p className="mt-2 text-xs text-slate-400">{t("Faithfulness", "Fidelidade")} {percentage(item.faithfulness)} · {t("Mean latency", "Latência média")} {number.format(Math.round(item.meanLatencyMs))} ms</p>
            {comparableCost && item.meanCostUsd !== null && <p className="mt-1 text-xs text-slate-400">
              {item.costSource === "observed" ? t("Mean observed cost", "Custo médio informado") : t("Mean estimated cost", "Custo médio estimado")} {currency.format(item.meanCostUsd)}
            </p>}
          </div>)}
        </div>
      </section>}
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
              {runs.map((run) => {
                const effort = readEvaluationQuality(run)?.faithfulness.effort;
                const measurement = evaluationMeasurementExport(run);
                return (
                <tr className="border-b border-slate-900" key={run.id}>
                  <td className="px-3 py-3">
                    <p className="text-slate-300">{date.format(new Date(run.createdAt))}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-400">{run.commitSha?.slice(0, 7) ?? t("local", "local")}</p>
                    {effort && <p className="mt-1 text-slate-400">{t(...effortLabels[effort])} · {run.chatModel}</p>}
                    {measurement && <button type="button" className="text-action mt-1" onClick={() => downloadMeasurements(measurement)}>
                      {t("Export measurements", "Exportar medições")}
                    </button>}
                  </td>
                  <td className={"px-3 py-3 font-mono " + metricTone(run.hitRate, 0.8)}>{percentage(run.hitRate)}</td>
                  <td className={"px-3 py-3 font-mono " + metricTone(run.meanReciprocalRank, 0.7)}>{percentage(run.meanReciprocalRank)}</td>
                  <td className={"px-3 py-3 font-mono " + metricTone(run.injectionPassRate, 1)}>{percentage(run.injectionPassRate)}</td>
                  <td className="px-3 py-3 text-slate-400">{percentage(run.faithfulness)}</td>
                  <td className="px-3 py-3 text-slate-400">{percentage(run.contextPrecision)}</td>
                  <td className={"px-3 py-3 " + (run.passed ? "text-emerald-300" : "text-rose-300")}>{result(run.passed)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={"mt-2 font-mono text-lg " + tone}>{value}</p>
    </div>
  );
}
