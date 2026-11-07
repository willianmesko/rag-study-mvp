import { useId } from "react";
import type { QuestionComparisonResponse } from "@rag-study/contracts";
import { useLocale } from "../../../shared/i18n/locale";
import { ValidatedCitations } from "../../../shared/ui/RagEvidencePanel";
import { getRefusalCopy } from "../model/refusal-copy";

export function ModelComparisonResult({ comparison }: { comparison: QuestionComparisonResponse }) {
  const { t, locale } = useLocale();
  const titleId = useId();
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", currencyDisplay: "code", maximumFractionDigits: 6 });
  const duration = new Intl.NumberFormat(locale, { style: "unit", unit: "second", maximumFractionDigits: 2 });
  const count = new Intl.NumberFormat(locale);

  return (
    <section aria-labelledby={titleId} className="space-y-4">
      <div>
        <h3 id={titleId} className="text-xl font-semibold text-white">{t("Model comparison", "Comparação de modelos")}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          {t("The comparison uses one question and one set of document passages. Costs are estimates in USD.",
            "A comparação usa uma única pergunta e o mesmo conjunto de trechos. Os custos são estimativas em dólares.")}
        </p>
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        {comparison.results.map(({ model, response, latencyMs, estimatedCostUsd }) => {
          const refusal = getRefusalCopy(response?.refusalReason);
          const citations = refusal ? [] : response?.sources.filter((source) => response.citedChunkIds?.includes(source.chunkId)) ?? [];
          const unavailable = t("Unavailable", "Indisponível");
          const cost = estimatedCostUsd > 0 && estimatedCostUsd < 0.000001 ? `< ${currency.format(0.000001)}` : currency.format(estimatedCostUsd);
          return (
            <article key={model.id} aria-label={model.label} className="panel min-w-0 space-y-4">
              <h4 className="text-lg font-semibold text-white [overflow-wrap:anywhere]">{model.label}</h4>
              <dl className="grid gap-2 border-b border-slate-700 pb-4 text-sm">
                <div className="flex flex-wrap justify-between gap-x-2"><dt className="text-slate-300">{t("Generation time", "Tempo de geração")}</dt><dd className="text-slate-100">{duration.format(latencyMs / 1000)}</dd></div>
                <div className="flex flex-wrap justify-between gap-x-2"><dt className="text-slate-300">{t("Estimated cost", "Custo estimado")}</dt><dd className="text-slate-100">{cost}</dd></div>
                <div className="flex flex-wrap justify-between gap-x-2"><dt className="text-slate-300">{t("Checked citations", "Citações conferidas")}</dt><dd className="text-slate-100">{response ? count.format(citations.length) : unavailable}</dd></div>
              </dl>
              {response ? (
                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-100 [overflow-wrap:anywhere]">{refusal ? t(...refusal) : response.answer}</p>
              ) : (
                <p className="error-message">{t("This model could not finish its answer. You can still review any answer that completed.",
                  "Este modelo não conseguiu concluir a resposta. Você pode consultar a outra resposta se ela estiver disponível.")}</p>
              )}
              {citations.length > 0 && <details className="rounded-xl border border-slate-700 p-3">
                <summary className="rounded-md text-sm font-semibold text-cyan-200">{t("Read cited passages", "Ler trechos citados")}</summary>
                <div className="mt-3"><ValidatedCitations citations={citations} /></div>
              </details>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
