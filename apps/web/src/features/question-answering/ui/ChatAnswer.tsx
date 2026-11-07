import type { QuestionResponse } from "@rag-study/contracts";
import { useLocale } from "../../../shared/i18n/locale";
import { RagEvidencePanel } from "../../../entities/source/index";
import { getRefusalCopy } from "../model/refusal-copy";

export function ChatAnswer({ answer }: { answer: QuestionResponse }) {
  const { t, locale } = useLocale();
  const refusal = getRefusalCopy(answer.refusalReason);
  const citations = answer.cacheHit ? [] : answer.sources.filter((source) => answer.citedChunkIds?.includes(source.chunkId));
  const hasEvidence = !refusal && (citations.length > 0 || Boolean(answer.contextSources?.length) ||
    ((answer.cacheHit || answer.contextSources === undefined) && answer.sources.length > 0));

  return <div className="space-y-3">
    <p role={refusal ? "status" : undefined} className="whitespace-pre-wrap text-sm leading-7 text-slate-100 [overflow-wrap:anywhere]">
      {refusal ? t(...refusal) : answer.answer}
    </p>
    {(answer.model || answer.routing || answer.cacheHit) && <div className="space-y-1 text-xs leading-5 text-slate-300">
      {answer.model && <p className="[overflow-wrap:anywhere]">{t("Answer model", "Modelo de resposta")} · {answer.model.label}</p>}
      {answer.routing && <p>{answer.routing.reason === "simple"
        ? t("Automatic routing chose the simple-question profile.", "A seleção automática usou o perfil de perguntas simples.")
        : t("Automatic routing chose the complex-question profile.", "A seleção automática usou o perfil de perguntas complexas.")}
        {answer.routing.usedFallback && ` ${t("An approved fallback produced this answer.", "Um modelo alternativo aprovado produziu esta resposta.")}`}
      </p>}
      {answer.cacheHit && <p>{t("Reused a saved answer", "Resposta salva reutilizada")}</p>}
    </div>}
    {hasEvidence && <details className="rounded-xl border border-slate-700 bg-slate-950/40">
      <summary className="min-h-11 rounded-xl px-3 py-3 text-sm font-semibold text-cyan-200 transition-colors hover:bg-slate-800">
        {t("Read sources and passages", "Ler fontes e trechos")}
        {citations.length > 0 && <span className="ml-2 text-xs font-normal text-slate-300">· {citations.length.toLocaleString(locale)} {citations.length === 1 ? t("checked citation", "citação conferida") : t("checked citations", "citações conferidas")}</span>}
      </summary>
      <div className="min-w-0 p-2"><RagEvidencePanel response={answer} citations={citations} /></div>
    </details>}
    {answer.usage && <details className="text-xs text-slate-300">
      <summary className="w-fit rounded-md px-1 py-2 hover:text-slate-100">{t("Run details", "Detalhes da execução")}</summary>
      <p className="mt-1 leading-5">
        {t("Prompt", "Prompt")} {answer.usage.promptVersion} · {answer.usage.latencyMs.toLocaleString(locale)} ms · {answer.usage.citationCount.toLocaleString(locale)} {t("citations", "citações")}
        {answer.usage.source === "observed" || answer.usage.source === "estimated" ? ` · ${answer.usage.inputTokens.toLocaleString(locale)} / ${answer.usage.outputTokens.toLocaleString(locale)} ${answer.usage.source === "observed"
          ? t("reported input/output tokens", "tokens de entrada/saída informados pelo provedor")
          : t("estimated input/output tokens", "tokens estimados de entrada/saída")}` : ""}
      </p>
      <p className="mt-1 leading-5">
        {answer.usage.observedCostUsd === undefined ? t("Estimated cost", "Custo estimado") : t("Reported cost", "Custo informado")} {new Intl.NumberFormat(locale, {
          style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 6
        }).format(answer.usage.observedCostUsd ?? answer.usage.estimatedCostUsd)}
      </p>
    </details>}
  </div>;
}
