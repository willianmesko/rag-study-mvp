import { useLayoutEffect, useRef, useState } from "react";
import { ApiError } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";
import { Mascot } from "../../../shared/ui/Mascot";
import { ValidatedCitations } from "../../../shared/ui/RagEvidencePanel";
import type { ConversationTurn, useConversation } from "../model/use-conversation";
import type { AnswerPhase } from "../model/use-live-answer";
import { ChatAnswer } from "./ChatAnswer";
import { ModelComparisonResult } from "./ModelComparisonResult";

const statusCopy: Record<AnswerPhase, [string, string]> = {
  accepted: ["Milo got your message", "O Milo recebeu sua mensagem"],
  retrieving: ["Looking through your documents", "Buscando nos seus documentos"],
  generating: ["Drafting your answer", "Preparando a resposta"],
  validating: ["Checking the sources", "Conferindo as fontes"],
  cached: ["Opening a recent answer", "Abrindo uma resposta recente"],
  delivering: ["Showing your answer and its sources", "Mostrando a resposta e as fontes"],
  reconnecting: ["Reconnecting to the same answer…", "Reconectando à mesma resposta…"],
  disconnected: ["Connection lost. Reconnect to pick up where you left off.", "A conexão caiu. Reconecte para retomar de onde parou."]
};

function TurnReply({ turn, live }: { turn: ConversationTurn; live: ReturnType<typeof useConversation>["live"] }) {
  const { t, locale } = useLocale();
  if (turn.answer) return <ChatAnswer answer={turn.answer} />;
  if (turn.comparison) return <ModelComparisonResult comparison={turn.comparison} />;
  if (turn.status === "cancelled") return <p role="status" className="text-sm text-slate-300">{turn.mode === "comparison"
    ? t("Comparison stopped.", "Comparação interrompida.") : t("Answer stopped.", "Resposta interrompida.")}</p>;
  if (turn.status === "failed") {
    const failureCopy = {
      quota_exceeded: t("Daily question limit reached. Try again tomorrow.", "O limite diário de perguntas foi atingido. Tente novamente amanhã."),
      execution_failed: t("Milo couldn't finish that answer. Try sending your message again.", "O Milo não conseguiu concluir a resposta. Tente enviar a mensagem novamente."),
      execution_interrupted: t("The answer was interrupted. Send your message again to start over.", "A resposta foi interrompida. Envie sua mensagem novamente para recomeçar.")
    };
    const message = turn.error instanceof ApiError && turn.error.status === 422
      ? t("This message exceeds the model budget. Try a shorter question or fewer passages.", "Esta mensagem excede o orçamento do modelo. Tente uma pergunta menor ou consulte menos trechos.")
      : turn.failure ? failureCopy[turn.failure] : turn.error ? getRequestErrorMessage(turn.error, locale) : failureCopy.execution_failed;
    return <p role="alert" className="text-sm leading-6 text-rose-200">{message}</p>;
  }
  if (turn.status !== "pending") return null;
  if (turn.mode === "comparison") return <p role="status" className="text-sm leading-6 text-slate-300">
    {t("Preparing both answers from the same passages…", "Preparando as duas respostas com os mesmos trechos…")}
  </p>;

  const phase = live.phase ?? "accepted";
  return <div className="space-y-3">
    <div className="flex items-center gap-2">
      {phase !== "disconnected" && <span aria-hidden="true" className="flex shrink-0 items-center gap-1 text-cyan-300">
        <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
        <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse [animation-delay:150ms]" />
        <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse [animation-delay:300ms]" />
      </span>}
      <p role="status" className="text-xs leading-5 text-slate-300">{t(...statusCopy[phase])}</p>
    </div>
    {live.draft && <p className="whitespace-pre-wrap text-sm leading-7 text-slate-100 [overflow-wrap:anywhere]">{live.draft}</p>}
    <ValidatedCitations citations={live.citations} />
    {live.stopError && <p role="alert" className="text-sm leading-6 text-rose-200">
      {t("We could not confirm that the answer stopped. Check your connection and try again.", "Não foi possível confirmar a interrupção. Confira sua conexão e tente novamente.")}
    </p>}
  </div>;
}

export function ConversationThread({ turns, live, demo, onSuggestion, suggestions: customSuggestions }: {
  turns: ConversationTurn[];
  live: ReturnType<typeof useConversation>["live"];
  demo: boolean;
  onSuggestion: (message: string) => void;
  suggestions?: string[];
}) {
  const { t } = useLocale();
  const transcript = useRef<HTMLDivElement>(null);
  const [showLatest, setShowLatest] = useState(false);
  const pinned = useRef(true);
  const latest = turns.at(-1);
  const previousLatest = useRef(latest?.id);

  function scrollToLatest() {
    pinned.current = true;
    setShowLatest(false);
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }

  useLayoutEffect(() => {
    if (!latest?.id) {
      previousLatest.current = undefined;
      pinned.current = true;
      if (transcript.current) transcript.current.scrollTop = 0;
      return;
    }
    if (previousLatest.current !== latest?.id) {
      previousLatest.current = latest?.id;
      scrollToLatest();
    } else if (pinned.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [latest?.id, latest?.status, live.phase, live.draft, live.citations.length]);

  function trackScroll() {
    const element = transcript.current;
    if (!element) return;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
    setShowLatest(!pinned.current);
  }

  const suggestions = customSuggestions ?? [
    t("Summarize the main points", "Resuma os pontos principais"),
    t("What can I learn from these documents?", "O que posso aprender com estes documentos?")
  ];

  return <div className="relative min-h-0 min-w-0 flex-1">
    <div role="region" aria-label={t("Conversation messages", "Mensagens da conversa")} tabIndex={0} ref={transcript}
      onScroll={trackScroll} className="h-full overflow-y-auto overscroll-contain px-3 py-5 focus-visible:-outline-offset-2 sm:px-6 [scrollbar-gutter:stable]">
      {turns.length === 0 ? <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-3 px-2 py-3 text-center sm:py-6">
        <div className="grid size-17 place-items-center rounded-3xl border border-cyan-300/25 bg-cyan-400/10 shadow-lg shadow-cyan-950/30 sm:size-20">
          <Mascot decorative size="sm" className="size-14 sm:size-16" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-white">{t("Hi, I’m Milo", "Oi, eu sou o Milo")}</h2>
        <p className="text-sm leading-6 text-slate-300">
          {demo
            ? t("Ask about the demo documents. Milo answers each question on its own here.", "Pergunte sobre os documentos de demonstração. Aqui, o Milo responde cada pergunta separadamente.")
            : t("Let’s explore your workspace documents. Ask a question to get started.", "Vamos explorar os documentos do seu espaço. Faça uma pergunta para começar.")}
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => onSuggestion(suggestion)}
            className="min-h-11 rounded-full border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200 transition-colors hover:border-cyan-400 hover:bg-slate-800">
            {suggestion}
          </button>)}
        </div>
      </div> : <ol className="mx-auto max-w-4xl space-y-5">
        {turns.map((turn) => <li key={turn.id} className="space-y-3">
          {turn.question && <div className="ml-auto w-fit max-w-[92%] sm:max-w-[78%]">
            <p className="mb-1 pr-1 text-right text-xs font-medium text-slate-300">{t("You", "Você")}</p>
            <p className="whitespace-pre-wrap rounded-2xl rounded-tr-sm border border-cyan-300/25 bg-cyan-900/45 px-3.5 py-2.5 text-sm leading-6 text-slate-50 [overflow-wrap:anywhere] sm:px-4">
              {turn.question}
            </p>
          </div>}
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-slate-200">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-cyan-300/25 bg-cyan-400/10">
                <Mascot decorative size="sm" className="size-6" />
              </span>
              Milo
            </div>
            <div className="min-w-0 rounded-2xl rounded-tl-sm border border-slate-700/90 bg-slate-900/90 p-3.5 sm:p-4">
              <TurnReply turn={turn} live={live} />
            </div>
          </div>
        </li>)}
      </ol>}
    </div>
    {showLatest && turns.length > 0 && <button type="button" onClick={() => {
      scrollToLatest();
      transcript.current?.focus({ preventScroll: true });
    }}
      className="secondary-button absolute right-5 bottom-3 shadow-lg shadow-slate-950/60">
      {t("Latest message", "Mensagem mais recente")} <span aria-hidden="true">↓</span>
    </button>}
    <span role="status" className="sr-only">{latest?.status === "completed" ? t("Milo replied.", "O Milo respondeu.") : ""}</span>
  </div>;
}
