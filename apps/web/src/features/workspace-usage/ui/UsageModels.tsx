import type { UsageModel } from "@rag-study/contracts";
import { useLocale } from "../../../shared/i18n/locale";
import {
  estimatedRemainder,
  formatUsageCost,
  recordedCost,
} from "../model/presentation";

export function UsageModels({
  models,
  expandedCoverage = false,
  total,
}: {
  models: UsageModel[];
  expandedCoverage?: boolean;
  total: number;
}) {
  const { locale, t } = useLocale(),
    number = new Intl.NumberFormat(locale),
    percent = new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 1,
    });
  const money = (value: number) => formatUsageCost(value, locale);
  return (
    <section aria-label={t("Cost by model", "Custo por modelo")}>
      <h3 className="text-sm font-semibold text-slate-100">
        {t("Cost by model", "Custo por modelo")}
      </h3>
      <p className="mt-1 text-xs leading-5 text-slate-400">
        {t(
          "Open a model to inspect tokens, response times and cost coverage.",
          "Abra um modelo para conferir tokens, tempos de resposta e origem dos custos.",
        )}
      </p>
      <div className="mt-3 divide-y divide-slate-800 border-y border-slate-800">
        {models.map((model) => {
          const cost = recordedCost(model),
            share = total > 0 ? Math.min(1, cost / total) : 0;
          const metrics = [
            [
              t("Recorded operations", "Operações registradas"),
              number.format(model.requests),
            ],
            [
              t("Reused answers", "Respostas reutilizadas"),
              number.format(model.cacheHits),
            ],
            [
              t("No generation started", "Sem geração iniciada"),
              number.format(model.skippedRequests),
            ],
            [
              t("Input / output tokens", "Tokens de entrada / saída"),
              `${number.format(model.inputTokens)} / ${number.format(model.outputTokens)}`,
            ],
            [
              t(
                expandedCoverage
                  ? "Average operation time"
                  : "Average response time",
                expandedCoverage
                  ? "Tempo médio por operação"
                  : "Tempo médio de resposta",
              ),
              `${number.format(Math.round(model.averageLatencyMs))} ms`,
            ],
            [
              t(
                expandedCoverage ? "P95 operation time" : "P95 response time",
                expandedCoverage
                  ? "Tempo P95 por operação"
                  : "Tempo de resposta P95",
              ),
              `${number.format(Math.round(model.p95LatencyMs))} ms`,
            ],
            [
              t("Failed operations", "Operações com falha"),
              number.format(model.providerFailures),
            ],
            [
              t("Reported cost", "Custo informado"),
              `${money(model.observedCostUsd)} · ${number.format(model.observedCostRequests)} ${t("operations", "operações")}`,
            ],
            [
              t("Estimated cost", "Custo estimado"),
              `${money(estimatedRemainder(model))} · ${number.format(model.estimatedCostRequests)} ${t("operations", "operações")}`,
            ],
            [
              t(
                "Reported tokens (in / out)",
                "Tokens informados (entrada / saída)",
              ),
              `${number.format(model.observedInputTokens)} / ${number.format(model.observedOutputTokens)}`,
            ],
            [
              t(
                "Estimated tokens (in / out)",
                "Tokens estimados (entrada / saída)",
              ),
              `${number.format(model.estimatedInputTokens)} / ${number.format(model.estimatedOutputTokens)}`,
            ],
          ];
          return (
            <details
              key={JSON.stringify([model.provider, model.model])}
              className="group py-1"
            >
              <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-slate-800/40">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90"
                >
                  <path d="m6 3 5 5-5 5" />
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs capitalize text-slate-400">
                    {model.provider}
                  </span>
                  <span className="block break-words text-sm font-medium text-slate-100 [overflow-wrap:anywhere]">
                    {model.model}
                  </span>
                  <span className="mt-1 block text-xs text-slate-400">
                    {number.format(model.requests)}{" "}
                    {t("operations", "operações")}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-sm text-slate-100">
                    {money(cost)}
                  </span>
                  <span className="mt-1 block text-xs text-slate-400">
                    {percent.format(share)}{" "}
                    {t("of recorded cost", "do custo registrado")}
                  </span>
                </span>
              </summary>
              <dl className="grid gap-x-6 gap-y-4 px-2 pb-5 pt-3 sm:grid-cols-2 xl:grid-cols-3">
                {metrics.map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs leading-5 text-slate-400">
                      {label}
                    </dt>
                    <dd className="mt-1 break-words text-sm text-slate-100">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="px-2 pb-4 text-xs leading-5 text-slate-400">
                {t(
                  "P95 is the time within which 95% of recorded operations completed. Response times include application work; they are not provider-only latency.",
                  "P95 é o tempo em que 95% das operações registradas foram concluídas. Os tempos incluem o trabalho da aplicação; não medem apenas o provedor.",
                )}
              </p>
            </details>
          );
        })}
      </div>
    </section>
  );
}
