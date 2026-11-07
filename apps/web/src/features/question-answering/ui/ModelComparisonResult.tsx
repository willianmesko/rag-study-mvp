import { useId } from "react";
import type { QuestionComparisonResponse } from "@rag-study/contracts";
import { useLocale } from "../../../shared/i18n/locale";
import { ValidatedCitations } from "../../../entities/source/index";
import { getRefusalCopy } from "../model/refusal-copy";
import { answerSafetyLabel, promptVariantLabel } from "../model/prompt-variants";

function refusalCode(reason: string | null | undefined) {
  if (!reason) return null;
  return ["insufficient_context", "invalid_citations", "unstructured_model_output", "unverified_claims"].includes(reason) ? reason : "model_refused";
}

function exportComparison(comparison: QuestionComparisonResponse) {
  const report = {
    schemaVersion: "1.0", exportedAt: new Date().toISOString(),
    mode: comparison.results[0].model.id === comparison.results[1].model.id ? "prompts" : "models",
    results: comparison.results.map(({ model, providerModel, prompt, response, error, latencyMs, estimatedCostUsd }) => ({
      modelId: model.id, provider: model.provider, providerModel, prompt, error, latencyMs, estimatedCostUsd,
      usage: response?.usage ?? null, refusalReason: refusalCode(response?.refusalReason),
      citedChunkIds: response?.citedChunkIds ?? [], contextChunkIds: response?.contextSources?.map(({ chunkId }) => chunkId) ?? []
    }))
  };
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = "lumora-answer-comparison.json"; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ModelComparisonResult({ comparison }: { comparison: QuestionComparisonResponse }) {
  const { t, locale } = useLocale();
  const titleId = useId();
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", currencyDisplay: "code", maximumFractionDigits: 6 });
  const duration = new Intl.NumberFormat(locale, { style: "unit", unit: "second", maximumFractionDigits: 2 });
  const count = new Intl.NumberFormat(locale);
  const promptsCompared = comparison.results[0].model.id === comparison.results[1].model.id;

  return (
    <section aria-labelledby={titleId} className="space-y-4">
      <div>
        <h3 id={titleId} className="text-xl font-semibold text-white">{promptsCompared ? t("Prompt comparison", "Comparação de prompts") : t("Model comparison", "Comparação de modelos")}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          {promptsCompared ? t("The same model answers one question with the same passages and two approved presentation prompts.", "O mesmo modelo responde uma pergunta com os mesmos trechos e dois prompts de apresentação aprovados.")
            : t("Both models answer one question using the same passages and prompt.", "Os dois modelos respondem uma pergunta com os mesmos trechos e prompt.")}
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-400">{t("Validation checks format and source IDs. Read the passages to check factual support. Costs are in USD.", "A validação confere formato e identificadores das fontes. Leia os trechos para conferir as afirmações. Os custos são em dólares.")}</p>
        <button type="button" className="text-action mt-2 min-h-11" onClick={() => exportComparison(comparison)}>{t("Export comparison metrics", "Exportar métricas da comparação")}</button>
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        {comparison.results.map(({ model, providerModel, prompt, response, latencyMs, estimatedCostUsd }, index) => {
          const refusal = getRefusalCopy(response?.refusalReason);
          const citations = refusal ? [] : response?.sources.filter((source) => response.citedChunkIds?.includes(source.chunkId)) ?? [];
          const unavailable = t("Unavailable", "Indisponível");
          const costValue = response?.usage?.observedCostUsd ?? estimatedCostUsd;
          const cost = costValue > 0 && costValue < 0.000001 ? `< ${currency.format(0.000001)}` : currency.format(costValue);
          const promptLabel = prompt ? promptVariantLabel(prompt.id, t) : null;
          return (
            <article key={`${model.id}:${prompt?.id ?? index}`} aria-label={promptsCompared && promptLabel ? `${model.label} · ${promptLabel}` : model.label} className="panel min-w-0 space-y-4">
              <h4 className="text-lg font-semibold text-white [overflow-wrap:anywhere]">{model.label}</h4>
              {providerModel && <p className="break-words text-xs text-slate-400">{model.provider} · {providerModel}</p>}
              {prompt && <p className="break-words text-xs text-slate-300">{t("Prompt", "Prompt")} · {promptLabel} · {prompt.version}</p>}
              <dl className="grid gap-2 border-b border-slate-700 pb-4 text-sm">
                <div className="flex flex-wrap justify-between gap-x-2"><dt className="text-slate-300">{t("Generation time", "Tempo de geração")}</dt><dd className="text-slate-100">{duration.format(latencyMs / 1000)}</dd></div>
                <div className="flex flex-wrap justify-between gap-x-2"><dt className="text-slate-300">{response?.usage?.observedCostUsd === undefined ? t("Estimated cost", "Custo estimado") : t("Reported cost", "Custo informado")}</dt><dd className="text-slate-100">{cost}</dd></div>
                <div className="flex flex-wrap justify-between gap-x-2"><dt className="text-slate-300">{t("Checked citations", "Citações conferidas")}</dt><dd className="text-slate-100">{response ? count.format(citations.length) : unavailable}</dd></div>
                {response?.usage && <div className="flex flex-wrap justify-between gap-x-2"><dt className="text-slate-300">{response.usage.source === "observed" ? t("Reported input / output tokens", "Tokens de entrada / saída informados") : t("Estimated input / output tokens", "Tokens de entrada / saída estimados")}</dt><dd className="text-slate-100">{count.format(response.usage.inputTokens)} / {count.format(response.usage.outputTokens)}</dd></div>}
                <div className="space-y-1"><dt className="text-slate-300">{t("Safety checks", "Verificações de segurança")}</dt><dd className="text-slate-100">{answerSafetyLabel(response?.usage?.safetyOutcome ?? (!response ? "provider_failed" : undefined), t)}</dd></div>
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
