import { useState, type FormEvent } from "react";
import { questionInputSchema, type QuestionResponse } from "@rag-study/contracts";
import { useLocale } from "../../../shared/i18n/locale";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";
import { InputLabel } from "../../../shared/ui/InputLabel";
import { SectionTitle } from "../../../shared/ui/SectionTitle";
import { RagEvidencePanel, ValidatedCitations } from "../../../shared/ui/RagEvidencePanel";
import { SelectField } from "../../../shared/ui/SelectField";
import { useLiveAnswer, type AnswerPhase } from "../model/use-live-answer";

const statusCopy: Record<AnswerPhase, [string, string]> = {
  accepted: ["Request accepted", "Pergunta recebida"],
  retrieving: ["Finding relevant passages", "Buscando trechos relevantes"],
  generating: ["Drafting your answer", "Preparando a resposta"],
  validating: ["Checking citations", "Conferindo as citações"],
  cached: ["Opening a saved answer", "Abrindo uma resposta já preparada"],
  delivering: ["Showing your answer and its sources", "Mostrando a resposta e suas fontes"],
  reconnecting: ["Reconnecting to the same answer…", "Reconectando à mesma resposta…"],
  disconnected: ["Connection lost. Reconnect to pick up where you left off.", "A conexão caiu. Reconecte para retomar de onde parou."]
};

function getRefusalCopy(reason: QuestionResponse["refusalReason"]): [string, string] | null {
  switch (reason) {
    case "insufficient_context":
      return ["I could not find enough information in the workspace documents to answer. Try a more specific question or check that the relevant document is indexed.",
        "Não encontrei informações suficientes nos documentos deste espaço para responder. Faça uma pergunta mais específica ou verifique se o documento relevante foi indexado."];
    case "invalid_citations":
      return ["I could not match the answer’s citations to the passages I found. Try again or make your question more specific.",
        "Não consegui vincular as citações da resposta aos trechos encontrados. Tente novamente ou faça uma pergunta mais específica."];
    case "unstructured_model_output":
      return ["I could not prepare an answer with sources this time. Try again or make your question more specific.",
        "Desta vez, não consegui preparar uma resposta com fontes. Tente novamente ou faça uma pergunta mais específica."];
    default:
      return reason ? ["I could not answer this question. Try asking it a different way.",
        "Não consegui responder a essa pergunta. Tente perguntar de outra forma."] : null;
  }
}

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
  const live = useLiveAnswer({ accessToken, workspaceId, scope, onAnswered });
  const { answer, phase } = live;
  const isStreaming = phase !== null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = questionInputSchema.safeParse({ question: question.trim(), topK });
    setInvalidInput(!parsed.success);
    if (parsed.success) live.start(parsed.data);
  }

  const failureCopy = {
    quota_exceeded: t("Daily question limit reached. Try again tomorrow.", "O limite diário de perguntas foi atingido. Tente novamente amanhã."),
    execution_failed: t("Lumora could not finish the answer. Try asking again.", "O Lumora não conseguiu concluir a resposta. Tente perguntar novamente."),
    execution_interrupted: t("This answer stopped before it finished. Ask again to start a new one.", "A resposta foi interrompida. Faça a pergunta novamente para iniciar outra.")
  };
  const error = invalidInput ? t("Enter a question of up to 5,000 characters.", "Digite uma pergunta de até 5.000 caracteres.")
    : live.failure ? failureCopy[live.failure] : live.error ? getRequestErrorMessage(live.error, locale) : null;
  const refusalCopy = getRefusalCopy(answer?.refusalReason);
  const citations = answer && !answer.cacheHit ? answer.sources.filter((source) => answer.citedChunkIds?.includes(source.chunkId)) : [];

  return (
    <form className="space-y-7" onSubmit={submit}>
      <SectionTitle eyebrow={t("Ask Lumora", "Pergunte ao Lumora")} title={t("Get an answer with sources", "Receba uma resposta com fontes")}>
        {t("Lumora searches your workspace for relevant passages and shows the sources behind the answer.",
           "O Lumora busca trechos relevantes no seu espaço de trabalho e mostra as fontes da resposta.")}
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
          <textarea aria-describedby="question-hint" value={question} maxLength={5000} readOnly={isStreaming}
            onChange={(event) => { setQuestion(event.target.value); setInvalidInput(false); }}
            className="field min-h-32 resize-y" placeholder={t("Explain RAG using my notes.", "Explique RAG usando as minhas anotações.")} />
          <span id="question-hint" className="text-xs font-normal text-slate-400">
            {t("A focused question usually leads to a clearer answer.", "Uma pergunta específica costuma gerar uma resposta mais clara.")}
          </span>
        </InputLabel>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SelectField className="w-44" label={t("Passages to search", "Trechos para consultar")}
            value={String(topK)} onValueChange={(value) => setTopK(Number(value))} disabled={isStreaming}
            options={["3", "5", "8"].map((value) => ({ value, label: value }))} />
          <div className="flex flex-wrap gap-2">
            {isStreaming && <button className="secondary-button enabled:cursor-pointer" type="button" onClick={() => void live.stop()} disabled={live.stopping}>
              {live.stopping ? t("Stopping…", "Interrompendo…") : t("Stop answer", "Parar resposta")}
            </button>}
            {phase === "disconnected"
              ? <button className="primary-button enabled:cursor-pointer" type="button" onClick={live.resume} disabled={live.stopping}>{t("Reconnect", "Reconectar")}</button>
              : <button className="primary-button enabled:cursor-pointer" disabled={isStreaming || question.trim().length === 0} type="submit">
                {isStreaming && <span className="spinner" aria-hidden="true" />}
                {isStreaming ? t("Working…", "Preparando…") : t("Ask Lumora", "Perguntar ao Lumora")}
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
      {live.stopError && <p role="alert" className="error-message">
        {t("We could not confirm that the answer stopped. Check your connection and try again.", "Não foi possível confirmar a interrupção. Confira sua conexão e tente novamente.")}
      </p>}
      {live.cancelled && <p role="status" className="panel text-sm text-slate-200">{t("Answer stopped.", "Resposta interrompida.")}</p>}
      {answer && <>
        <div className="panel animate-fade-up border-cyan-500/20 bg-cyan-500/5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <p className="eyebrow">{t("Your answer", "Sua resposta")}</p>
            {refusalCopy ? <span className="status-pill status-pill--warning">{t("Answer unavailable", "Resposta indisponível")}</span>
              : answer.cacheHit ? <span className="status-pill">{t("Saved answer reused", "Resposta salva reutilizada")}</span>
              : citations.length > 0 && <span className="status-pill status-pill--success">{t("Citations checked", "Citações conferidas")}</span>}
          </div>
          <p role={refusalCopy ? "status" : undefined} className="mt-5 whitespace-pre-wrap text-sm leading-7 text-slate-200">
            {refusalCopy ? t(...refusalCopy) : answer.answer}
          </p>
        </div>
        {!refusalCopy && <RagEvidencePanel response={answer} citations={citations} />}
      </>}
      {error && !isStreaming && <p role="alert" className="error-message">{error}</p>}
    </form>
  );
}
