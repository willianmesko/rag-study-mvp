import { useQueryIdentity } from "../../../shared/lib/query-identity";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UsageResponse } from "@rag-study/contracts";
import { usageQuery } from "../../../entities/workspace/model/usage";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";
import { SelectField } from "../../../shared/ui/SelectField";
import {
  estimatedRemainder,
  formatUsageCost,
  recordedCost,
} from "../model/presentation";
import { UsageModels } from "./UsageModels";
import { UsageTrend } from "./UsageTrend";

function exportUsage(data: UsageResponse) {
  const report = {
    ...data,
    coverage: data.summary.extendedSince
      ? "recorded_provider_operations"
      : "recorded_answer_operations",
    reportVersion: "1.0",
    exportedAt: new Date().toISOString(),
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `lumora-usage-${data.days}-days.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function WorkspaceUsage({
  workspaceId,
  token,
}: {
  workspaceId: string;
  token: string;
}) {
  const userId = useQueryIdentity();
  const { locale, t } = useLocale(),
    [days, setDays] = useState(30),
    number = new Intl.NumberFormat(locale);
  const usage = useQuery(usageQuery(token, workspaceId, userId, days)),
    summary = usage.data?.summary;
  const money = (value: number) => formatUsageCost(value, locale);
  const metrics = summary
    ? [
        [
          t("Recorded operations", "Operações registradas"),
          number.format(summary.requests),
        ],
        [
          t("Reused answers", "Respostas reutilizadas"),
          number.format(summary.cacheHits),
        ],
        [
          t("Input tokens", "Tokens de entrada"),
          number.format(summary.inputTokens),
        ],
        [
          t("Output tokens", "Tokens de saída"),
          number.format(summary.outputTokens),
        ],
        [
          t(
            summary.extendedSince
              ? "Average operation time"
              : "Average response time",
            summary.extendedSince
              ? "Tempo médio por operação"
              : "Tempo médio de resposta",
          ),
          `${number.format(Math.round(summary.averageLatencyMs))} ms`,
        ],
        [
          t("Failed operations", "Operações com falha"),
          number.format(summary.providerFailures),
        ],
      ]
    : [];
  const operationLabel = (operation: string) =>
    ({
      embedding_document: t("Document preparation", "Preparação de documentos"),
      embedding_query: t("Semantic search", "Busca semântica"),
      reranking: t("Source ranking", "Ordenação das fontes"),
      evidence_judging: t("Answer verification", "Verificação de respostas"),
      evaluation_judging: t("Quality assessment", "Avaliação de qualidade"),
      evaluation_generation: t("Evaluation answers", "Respostas de avaliação"),
      question_answering: t("Answers", "Respostas"),
      question_comparison: t(
        "Model and prompt comparisons",
        "Comparações de modelos e prompts",
      ),
      question_auto_routing: t(
        "Automatic model attempts",
        "Tentativas de seleção automática",
      ),
    })[operation] ?? t("Other operations", "Outras operações");
  return (
    <section
      aria-label={t("AI usage", "Uso de IA")}
      className="space-y-5 border-b border-slate-800 pb-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            {t("AI usage", "Uso de IA")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            {t(
              summary?.extendedSince
                ? "See which models account for your recorded AI costs."
                : "See which models account for your recorded answer costs.",
              summary?.extendedSince
                ? "Veja quais modelos compõem os custos registrados de IA."
                : "Veja quais modelos compõem os custos registrados das suas respostas.",
            )}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            {t(
              summary?.extendedSince
                ? "Recorded calls now include embeddings, reranking and judges. Older records cover answers only."
                : "Answer generation only. Other AI stages are not included.",
              summary?.extendedSince
                ? "Os registros atuais incluem embeddings, reranking e avaliadores. Registros antigos cobrem apenas respostas."
                : "Somente geração de respostas. Outras etapas de IA não estão incluídas.",
            )}
          </p>
        </div>
        <SelectField
          label={t("Usage period", "Período de uso")}
          value={String(days)}
          onValueChange={(value) => {
            if (["7", "30", "90"].includes(value)) setDays(Number(value));
          }}
          options={[7, 30, 90].map((value) => ({
            value: String(value),
            label: t(`Last ${value} days`, `Últimos ${value} dias`),
          }))}
          className="w-full sm:w-48"
        />
      </div>
      {Boolean(summary?.unpricedRequests) && (
        <p className="text-sm text-amber-100" role="status">
          {t(
            "Some calls have no reported cost or configured price. The total excludes their unknown cost.",
            "Algumas chamadas não têm custo informado nem preço configurado. O total não inclui esse custo desconhecido.",
          )}
        </p>
      )}
      {usage.isLoading && (
        <div
          role="status"
          className="min-h-40 animate-pulse rounded-xl bg-slate-800/30 p-4 text-sm text-slate-400"
        >
          {t("Loading usage details…", "Carregando detalhes de uso…")}
        </div>
      )}
      {usage.isError && (
        <div role="alert" className="space-y-2">
          <p className="error-message">
            {workspaceRequestError(
              usage.error,
              t,
              t(
                "Could not load usage details.",
                "Não foi possível carregar os detalhes de uso.",
              ),
            )}
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={usage.isFetching}
            onClick={() => void usage.refetch()}
          >
            {t("Try again", "Tentar novamente")}
          </button>
        </div>
      )}
      {usage.data && summary && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs text-slate-400">
                {t("Recorded cost", "Custo registrado")}
              </p>
              <p className="mt-1 font-mono text-2xl text-slate-100">
                {money(recordedCost(summary))}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                {money(summary.observedCostUsd)} {t("reported", "informado")} +{" "}
                {money(estimatedRemainder(summary))}{" "}
                {t("estimated", "estimado")}
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => exportUsage(usage.data!)}
              disabled={usage.isFetching || summary.requests === 0}
            >
              {t("Export metrics", "Exportar métricas")}
            </button>
          </div>
          {usage.data.alert.triggered && (
            <p
              role="status"
              className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-100"
            >
              {t(
                "Recorded cost reached the budget alert of",
                "O custo registrado atingiu o alerta de orçamento de",
              )}{" "}
              {money(usage.data.alert.thresholdUsd)}.
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
            {metrics.map(([label, value]) => (
              <div className="min-w-0" key={label}>
                <dt className="text-xs leading-5 text-slate-400">{label}</dt>
                <dd className="mt-1 font-mono text-sm text-slate-100">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {summary.requests === 0 ? (
            <p className="empty-state">
              {t(
                "No answer operations were recorded in this period. Ask a question or choose a longer period.",
                "Nenhuma operação de resposta foi registrada neste período. Faça uma pergunta ou escolha um período maior.",
              )}
            </p>
          ) : (
            <>
              {summary.models.length > 0 ? (
                <UsageModels
                  models={summary.models}
                  expandedCoverage={Boolean(summary.extendedSince)}
                  total={recordedCost(summary)}
                />
              ) : (
                <p className="text-sm text-slate-400">
                  {t(
                    "Model details are not available for this response yet.",
                    "Os detalhes por modelo ainda não estão disponíveis nesta consulta.",
                  )}
                </p>
              )}
              <UsageTrend data={usage.data} />
              <details className="border-t border-slate-800 pt-2">
                <summary className="min-h-11 cursor-pointer rounded-md py-3 text-sm text-slate-300 hover:text-slate-100">
                  {t("Usage by operation", "Uso por operação")}
                </summary>
                <ul className="divide-y divide-slate-800">
                  {summary.operations.map((operation) => (
                    <li
                      key={operation.operation}
                      className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                    >
                      <span className="text-slate-300">
                        {operationLabel(operation.operation)} ·{" "}
                        {number.format(operation.requests)}
                      </span>
                      <span className="font-mono text-slate-100">
                        {money(recordedCost(operation))}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
          <details className="border-t border-slate-800 pt-2">
            <summary className="min-h-11 cursor-pointer rounded-md py-3 text-sm text-slate-300 hover:text-slate-100">
              {t(
                "How these costs are calculated",
                "Como estes custos são calculados",
              )}
            </summary>
            <div className="space-y-3 pb-2 text-xs leading-6 text-slate-400">
              <p>
                {t(
                  "Recorded cost uses the provider-reported amount when available and the saved estimate otherwise. A reported amount and its estimate are never added together. Reported tokens do not automatically mean a reported price.",
                  "O custo registrado usa o valor informado pelo provedor quando disponível e a estimativa salva nos demais casos. Um valor informado e sua estimativa nunca são somados. Tokens informados não significam necessariamente um preço informado.",
                )}
              </p>
              <p>
                {t(
                  summary.extendedSince
                    ? "New records include answer generation, embeddings, reranking and evaluation calls. Older records cover answers only. This is not a full provider invoice."
                    : "This history covers recorded answer, comparison and automatic-routing operations. Embeddings, reranking and evidence-judge calls are not included here yet. It is not a full provider invoice.",
                  summary.extendedSince
                    ? "Os novos registros incluem respostas, embeddings, reranking e avaliações. Os registros antigos cobrem apenas respostas. Este total não representa a fatura completa do provedor."
                    : "Este histórico inclui operações registradas de resposta, comparação e seleção automática. Embeddings, reranking e chamadas de avaliação de evidências ainda não entram neste total. Ele não representa a fatura completa do provedor.",
                )}
              </p>
              <p>
                {t(
                  "One question can produce several operations. Reused answers have zero generation cost; no avoided-cost amount is inferred. Estimates retain the prices used when each operation was recorded. Daily groups use UTC and the selected period is a rolling window.",
                  "Uma pergunta pode gerar várias operações. Respostas reutilizadas têm custo de geração zero; não calculamos uma economia hipotética. As estimativas mantêm os preços usados no registro de cada operação. Os dias usam UTC e o período selecionado é uma janela móvel.",
                )}
              </p>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
