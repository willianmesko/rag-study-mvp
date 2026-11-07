import { useEffect, useRef, useState, type FormEvent } from "react";
import { questionInputSchema } from "@rag-study/contracts";
import { api, type AnswerStreamEvent, type QuestionResponse } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";
import { InputLabel } from "../../../shared/ui/InputLabel";
import { SectionTitle } from "../../../shared/ui/SectionTitle";
import { RagEvidencePanel } from "../../../shared/ui/RagEvidencePanel";
import { SelectField } from "../../../shared/ui/SelectField";

type StreamStatus = "accepted" | "retrieving" | "generating" | "validating" | "cached";

const statusCopy: Record<StreamStatus, [string, string]> = {
  accepted: ["Request accepted", "Pergunta recebida"],
  retrieving: ["Finding relevant passages", "Buscando trechos relevantes"],
  generating: ["Drafting your answer", "Preparando a resposta"],
  validating: ["Checking citations", "Conferindo as citações"],
  cached: ["Opening a saved answer", "Abrindo uma resposta já preparada"]
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

export function QuestionAnswerForm({ onAnswered, accessToken, workspaceId, workspaceName }: {
  onAnswered: (input: { question: string; response: QuestionResponse }) => void;
  accessToken?: string | null;
  workspaceId?: string;
  workspaceName?: string;
}) {
  const { t, locale } = useLocale();
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(5);
  const [invalidInput, setInvalidInput] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus | null>(null);
  const [streamedAnswer, setStreamedAnswer] = useState("");
  const [answer, setAnswer] = useState<QuestionResponse | null>(null);
  const [streamError, setStreamError] = useState<Error | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controllerRef.current) return;
    const parsed = questionInputSchema.safeParse({ question: question.trim(), topK });
    setInvalidInput(!parsed.success);
    if (!parsed.success) return;

    setStreamError(null);
    setAnswer(null);
    setStreamedAnswer("");
    setStreamStatus("accepted");
    const controller = new AbortController();
    controllerRef.current = controller;
    const input = { ...parsed.data, accessToken: accessToken ?? undefined, workspaceId, signal: controller.signal };
    let receivedEvent = false;
    let reusedAnswer = false;

    function handleStreamEvent(update: AnswerStreamEvent) {
      receivedEvent = true;
      if (controller.signal.aborted) return;
      if (update.type === "cached") reusedAnswer = true;
      if (update.type === "token") setStreamedAnswer((value) => value + update.delta);
      else if (update.type !== "completed" && update.type !== "error") setStreamStatus(reusedAnswer ? "cached" : update.type);
    }

    try {
      let response: QuestionResponse;
      try {
        response = await api.answerStream(input, handleStreamEvent);
      } catch (error) {
        if (receivedEvent || controller.signal.aborted) throw error;
        response = await api.answer(input);
      }
      if (controller.signal.aborted) return;
      if (reusedAnswer && response.cacheHit === undefined) response = { ...response, cacheHit: true };
      setAnswer(response);
      if (!response.refusalReason) onAnswered({ question: input.question, response });
    } catch (error) {
      if (!controller.signal.aborted) {
        setStreamError(error instanceof Error ? error : new Error("The answer could not be completed."));
      }
    } finally {
      controllerRef.current = null;
      setStreamStatus(null);
    }
  }

  const isStreaming = streamStatus !== null;
  const error = invalidInput ? t("Enter a question of up to 5,000 characters.", "Digite uma pergunta de até 5.000 caracteres.")
    : streamError ? getRequestErrorMessage(streamError, locale) : null;
  const refusalCopy = getRefusalCopy(answer?.refusalReason);
  const citations = answer && !answer.cacheHit ? answer.sources.filter((source) => answer.citedChunkIds?.includes(source.chunkId)) : [];

  return (
    <form className="space-y-7" onSubmit={submit} aria-busy={isStreaming}>
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
          <textarea aria-describedby="question-hint" value={question} maxLength={5000} onChange={(event) => setQuestion(event.target.value)}
            className="field min-h-32 resize-y" placeholder={t("Explain RAG using my notes.", "Explique RAG usando as minhas anotações.")} />
          <span id="question-hint" className="text-xs font-normal text-slate-400">
            {t("A focused question usually leads to a clearer answer.", "Uma pergunta específica costuma gerar uma resposta mais clara.")}
          </span>
        </InputLabel>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SelectField className="w-44" label={t("Passages to search", "Trechos para consultar")}
            value={String(topK)} onValueChange={(value) => setTopK(Number(value))}
            options={["3", "5", "8"].map((value) => ({ value, label: value }))} />
          <div className="flex flex-wrap gap-2">
            {isStreaming && <button className="secondary-button" type="button" onClick={() => controllerRef.current?.abort()}>{t("Stop answer", "Parar resposta")}</button>}
            <button className="primary-button" disabled={isStreaming || question.trim().length === 0} type="submit">
              {isStreaming && <span className="spinner" aria-hidden="true" />}
              {isStreaming ? t("Working…", "Preparando…") : t("Ask Lumora", "Perguntar ao Lumora")}
            </button>
          </div>
        </div>
      </div>
      {streamStatus && <section className="stream-status-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="eyebrow">{t("Live answer", "Resposta em andamento")}</p>
          <p role="status" className="text-sm text-slate-200">{t(...statusCopy[streamStatus])}</p>
        </div>
        <div aria-hidden="true" className="mt-4 h-1 overflow-hidden rounded-full bg-slate-800"><div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" /></div>
        {streamedAnswer && <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-200">{streamedAnswer}</p>}
      </section>}
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
