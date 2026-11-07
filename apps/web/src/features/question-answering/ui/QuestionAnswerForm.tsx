import { useId, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { questionComparisonInputSchema, questionInputSchema, type QuestionResponse } from "@rag-study/contracts";
import { ApiError, api } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";
import { InputLabel } from "../../../shared/ui/InputLabel";
import { SectionTitle } from "../../../shared/ui/SectionTitle";
import { RagEvidencePanel, ValidatedCitations } from "../../../shared/ui/RagEvidencePanel";
import { SelectField } from "../../../shared/ui/SelectField";
import { getRefusalCopy } from "../model/refusal-copy";
import { useLiveAnswer, type AnswerPhase } from "../model/use-live-answer";
import { useModelComparison } from "../model/use-model-comparison";
import { ModelComparisonResult } from "./ModelComparisonResult";

const statusCopy: Record<AnswerPhase, [string, string]> = {
  accepted: ["Request accepted", "Pergunta recebida"],
  retrieving: ["Looking through your documents", "Buscando nos seus documentos"],
  generating: ["Drafting your answer", "Preparando a resposta"],
  validating: ["Checking the sources", "Conferindo as fontes"],
  cached: ["Opening a recent answer", "Abrindo uma resposta recente"],
  delivering: ["Showing your answer and its sources", "Mostrando a resposta e as fontes"],
  reconnecting: ["Reconnecting to the same answer…", "Reconectando à mesma resposta…"],
  disconnected: ["Connection lost. Reconnect to pick up where you left off.", "A conexão caiu. Reconecte para retomar de onde parou."]
};

export function QuestionAnswerForm({ onAnswered, accessToken, workspaceId, workspaceName, scope }: {
  onAnswered: (input: { question: string; response: QuestionResponse }) => void;
  accessToken?: string | null;
  workspaceId?: string;
  workspaceName?: string;
  scope: string;
}) {
  const { t, locale } = useLocale();
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(5);
  const [invalidInput, setInvalidInput] = useState(false);
  const [preferredModelId, setPreferredModelId] = useState<string>();
  const [alternateModelId, setAlternateModelId] = useState<string>();
  const [compareMode, setCompareMode] = useState(false);
  const comparisonName = useId();
  const comparisonHint = useId();
  const catalog = useQuery({
    queryKey: ["chat-models", scope],
    queryFn: ({ signal }) => api.chatModels(accessToken!, workspaceId!, signal),
    enabled: Boolean(accessToken && workspaceId), retry: false, staleTime: 60_000
  });
  const live = useLiveAnswer({ accessToken, workspaceId, scope, onAnswered });
  const comparison = useModelComparison();
  const models = catalog.isError ? [] : catalog.data?.models ?? [];
  const selectedModel = models.find(({ id }) => id === preferredModelId) ?? models.find(({ isDefault }) => isDefault) ?? models[0];
  const alternates = models.filter(({ id }) => id !== selectedModel?.id);
  const alternateModel = alternates.find(({ id }) => id === alternateModelId) ?? alternates[0];
  const comparisonAvailable = Boolean(catalog.data?.comparisonAvailable && selectedModel && alternateModel);
  const autoAvailable = Boolean(catalog.data?.autoAvailable && !catalog.isError);
  const comparing = compareMode && comparisonAvailable;
  const autoSelected = autoAvailable && !comparing && preferredModelId === "auto";
  const { phase } = live;
  const answer = comparing ? undefined : live.answer;
  const isStreaming = phase !== null;
  const busy = isStreaming || comparison.isPending;
  const modelOptions = (available: typeof models) => available.map(({ id, label, isDefault }) => ({
    value: id, label, description: isDefault ? t("Workspace default", "Padrão do espaço") : undefined
  }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (comparing && selectedModel && alternateModel && accessToken && workspaceId) {
      const input = questionComparisonInputSchema.safeParse({ question: question.trim(), topK, modelIds: [selectedModel.id, alternateModel.id] });
      setInvalidInput(!input.success);
      if (input.success) comparison.start(input.data, accessToken, workspaceId);
      return;
    }
    const parsed = questionInputSchema.safeParse({ question: question.trim(), topK, modelId: autoSelected ? "auto" : selectedModel?.id });
    setInvalidInput(!parsed.success);
    if (parsed.success) live.start(parsed.data);
  }

  const failureCopy = {
    quota_exceeded: t("Daily question limit reached. Try again tomorrow.", "O limite diário de perguntas foi atingido. Tente novamente amanhã."),
    execution_failed: t("Lumora could not finish the answer. Try asking again.", "O Lumora não conseguiu concluir a resposta. Tente perguntar novamente."),
    execution_interrupted: t("This answer stopped before it finished. Ask again to start a new one.", "A resposta foi interrompida. Faça a pergunta novamente para iniciar outra.")
  };
  const requestError = comparing ? comparison.error : live.error;
  const error = invalidInput ? t("Enter a question of up to 5,000 characters.", "Digite uma pergunta de até 5.000 caracteres.")
    : requestError instanceof ApiError && requestError.status === 422 ? t("This request exceeds the model budget. Try a shorter question or fewer passages.", "Esta solicitação excede o orçamento do modelo. Tente uma pergunta menor ou consulte menos trechos.")
    : !comparing && live.failure ? failureCopy[live.failure] : requestError ? getRequestErrorMessage(requestError, locale) : null;
  const refusalCopy = getRefusalCopy(answer?.refusalReason);
  const citations = answer && !answer.cacheHit ? answer.sources.filter((source) => answer.citedChunkIds?.includes(source.chunkId)) : [];

  return (
    <form className="space-y-7" onSubmit={submit}>
      <SectionTitle eyebrow={t("Ask Lumora", "Pergunte ao Lumora")} title={t("Get an answer with sources", "Receba uma resposta com fontes")}>
        {t("Ask in your own words. Lumora looks for relevant passages and shows the sources it can cite.",
           "Pergunte com suas palavras. O Lumora busca trechos relevantes e mostra as fontes que pode citar.")}
      </SectionTitle>
      <div className="panel space-y-5">
        <div className="workspace-context flex-wrap">
          <span className="workspace-context__dot" aria-hidden="true" />
          <div>
            <p className="eyebrow">{t("Answering from", "Respondendo com base em")}</p>
            <p className="mt-1 text-sm font-medium text-slate-100">{workspaceName ?? t("Demo workspace", "Espaço de demonstração")}</p>
          </div>
          <span className="ml-auto text-xs text-slate-400">{accessToken ? t("Private documents", "Documentos privados") : t("Public demo", "Demonstração pública")}</span>
        </div>
        <InputLabel label={t("What would you like to know?", "O que você gostaria de saber?")}>
          <textarea aria-describedby="question-hint" value={question} maxLength={5000} readOnly={busy}
            onChange={(event) => { setQuestion(event.target.value); setInvalidInput(false); }}
            className="field min-h-32 resize-y" placeholder={t("For example, what does our policy say about access requests?", "Por exemplo, o que a nossa política diz sobre pedidos de acesso?")} />
          <span id="question-hint" className="text-xs font-normal text-slate-400">
            {t("A focused question usually leads to a clearer answer.", "Uma pergunta específica costuma gerar uma resposta mais clara.")}
          </span>
        </InputLabel>
        {selectedModel && (models.length === 1 && !autoAvailable ? <div className="rounded-xl border border-slate-700 px-3 py-2.5">
          <p className="text-xs text-slate-300">{t("Workspace answer model", "Modelo de resposta do espaço")}</p>
          <p className="mt-1 text-sm font-semibold text-slate-100 [overflow-wrap:anywhere]">{selectedModel.label}</p>
        </div> : <fieldset className="grid min-w-0 gap-3">
          <legend className="sr-only">{t("Answer models", "Modelos de resposta")}</legend>
          {comparisonAvailable && <label className={`flex min-h-11 items-start gap-3 rounded-xl border border-slate-700 px-3 py-2.5 text-sm ${busy ? "cursor-not-allowed" : "cursor-pointer hover:bg-slate-800"}`}>
            <input type="checkbox" className="mt-1 size-4 shrink-0 accent-cyan-300" checked={comparing} disabled={busy}
              aria-labelledby={comparisonName} aria-describedby={comparisonHint} onChange={(event) => setCompareMode(event.target.checked)} />
            <span>
              <span id={comparisonName} className="block font-semibold text-slate-100">{t("Compare two models", "Comparar dois modelos")}</span>
              <span id={comparisonHint} className="mt-1 block text-xs leading-5 text-slate-300">
                {t("Use the same question and passages for both models. Each comparison uses two questions from your daily limit.",
                  "Os dois modelos recebem a mesma pergunta e os mesmos trechos. Cada comparação usa duas perguntas do seu limite diário.")}
              </span>
            </span>
          </label>}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <SelectField label={comparing ? t("First model", "Primeiro modelo") : t("Answer model", "Modelo de resposta")}
              value={autoSelected ? "auto" : selectedModel.id} onValueChange={setPreferredModelId} disabled={busy}
              options={autoAvailable && !comparing ? [{ value: "auto", label: t("Automatic", "Automático"),
                description: t("Selects an allowed model by question complexity.", "Escolhe um modelo permitido pela complexidade da pergunta.") }, ...modelOptions(models)] : modelOptions(models)} />
            {comparing && alternateModel && <SelectField label={t("Second model", "Segundo modelo")}
              value={alternateModel.id} onValueChange={setAlternateModelId} disabled={busy} options={modelOptions(alternates)} />}
          </div>
        </fieldset>)}
        {catalog.isError && !(catalog.error instanceof ApiError && catalog.error.status === 404) && <p className="text-xs text-slate-300" role="status">
          {t("Model options are unavailable. Ask will use the workspace default.", "As opções de modelo estão indisponíveis. As perguntas usam o modelo padrão do espaço.")}
        </p>}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SelectField className="w-44" label={t("Passages to consider", "Trechos para consultar")}
            value={String(topK)} onValueChange={(value) => setTopK(Number(value))} disabled={busy}
            options={["3", "5", "8"].map((value) => ({ value, label: value }))} />
          <div className="flex flex-wrap gap-2">
            {isStreaming && <button className="secondary-button" type="button" onClick={() => void live.stop()} disabled={live.stopping} aria-busy={live.stopping}>
              {live.stopping ? t("Stopping…", "Interrompendo…") : t("Stop answer", "Parar resposta")}
            </button>}
            {comparison.isPending && <button className="secondary-button" type="button" onClick={comparison.stop}>{t("Stop comparison", "Parar comparação")}</button>}
            {phase === "disconnected"
              ? <button className="primary-button" type="button" onClick={live.resume} disabled={live.stopping}>{t("Reconnect", "Reconectar")}</button>
              : <button className="primary-button" disabled={busy || question.trim().length === 0} type="submit" aria-busy={busy}>
                {busy && <span className="spinner" aria-hidden="true" />}
                {comparing ? comparison.isPending ? t("Comparing…", "Comparando…") : t("Compare answers", "Comparar respostas")
                  : isStreaming ? t("Working…", "Preparando…") : t("Ask Lumora", "Perguntar ao Lumora")}
              </button>}
          </div>
        </div>
      </div>
      {phase && <section className="stream-status-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="eyebrow">{t("Live answer", "Resposta em andamento")}</p>
          <p role="status" className="text-sm text-slate-200">{t(...statusCopy[phase])}</p>
        </div>
        {phase !== "disconnected" && <div aria-hidden="true" className="mt-4 h-1 overflow-hidden rounded-full bg-slate-800"><div className="h-full w-1/2 rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 motion-safe:animate-pulse" /></div>}
        {live.draft && <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-200">{live.draft}</p>}
        {live.citations.length > 0 && <div className="mt-5"><ValidatedCitations citations={live.citations} /></div>}
      </section>}
      {!comparing && live.stopError && <p role="alert" className="error-message">
        {t("We could not confirm that the answer stopped. Check your connection and try again.", "Não foi possível confirmar a interrupção. Confira sua conexão e tente novamente.")}
      </p>}
      {!comparing && live.cancelled && <p role="status" className="panel text-sm text-slate-200">{t("Answer stopped.", "Resposta interrompida.")}</p>}
      {comparing && comparison.isPending && <p role="status" className="stream-status-card text-sm text-slate-200">{t("Preparing both answers from the same passages…", "Preparando as duas respostas com os mesmos trechos…")}</p>}
      {comparing && comparison.stopped && <p role="status" className="panel text-sm text-slate-200">{t("Comparison stopped.", "Comparação interrompida.")}</p>}
      {comparing && comparison.data && <ModelComparisonResult comparison={comparison.data} />}
      {answer && <>
        <div className="panel animate-fade-up border-cyan-500/20 bg-cyan-500/5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <p className="eyebrow">{t("Your answer", "Sua resposta")}</p>
            {refusalCopy ? <span className="status-pill status-pill--warning">{t("Answer unavailable", "Resposta indisponível")}</span>
              : answer.cacheHit ? <span className="status-pill">{t("Saved answer reused", "Resposta salva reutilizada")}</span>
              : citations.length > 0 && <span className="status-pill status-pill--success">{t("Citations checked", "Citações conferidas")}</span>}
          </div>
          {answer.model && <p className="mt-2 text-xs text-slate-300 [overflow-wrap:anywhere]">{t("Answer model", "Modelo de resposta")} · {answer.model.label}</p>}
          {answer.routing && <p className="mt-2 text-xs text-slate-300">{answer.routing.reason === "simple"
            ? t("Automatic routing chose the simple-question profile.", "A seleção automática usou o perfil de perguntas simples.")
            : t("Automatic routing chose the complex-question profile.", "A seleção automática usou o perfil de perguntas complexas.")}
            {answer.routing.usedFallback && ` ${t("An approved fallback produced this answer.", "Um modelo alternativo aprovado produziu esta resposta.")}`}
          </p>}
          <p role={refusalCopy ? "status" : undefined} className="mt-5 whitespace-pre-wrap text-sm leading-7 text-slate-200">
            {refusalCopy ? t(...refusalCopy) : answer.answer}
          </p>
          {answer.usage && <details className="mt-4 text-xs text-slate-300">
            <summary className="w-fit rounded-md py-1 hover:text-slate-100">{t("Run details", "Detalhes da execução")}</summary>
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
        </div>
        {!refusalCopy && <RagEvidencePanel response={answer} citations={citations} />}
      </>}
      {error && !busy && <p role="alert" className="error-message">{error}</p>}
    </form>
  );
}
