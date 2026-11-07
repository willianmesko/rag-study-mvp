import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { questionComparisonInputSchema, questionInputSchema } from "@rag-study/contracts";
import { ApiError, api } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { Mascot } from "../../../shared/ui/Mascot";
import { SelectField } from "../../../shared/ui/SelectField";
import type { useConversation } from "../model/use-conversation";
import { ConversationThread } from "./ConversationThread";

export function QuestionAnswerForm({ conversation, accessToken, workspaceId, workspaceName, scope, embedded = false, suggestions }: {
  conversation: ReturnType<typeof useConversation>;
  accessToken?: string | null;
  workspaceId?: string;
  workspaceName?: string;
  scope: string;
  embedded?: boolean;
  suggestions?: string[];
}) {
  const { t } = useLocale();
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(5);
  const [invalidInput, setInvalidInput] = useState(false);
  const [preferredModelId, setPreferredModelId] = useState<string>();
  const [alternateModelId, setAlternateModelId] = useState<string>();
  const [compareMode, setCompareMode] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const composerId = useId();
  const hintId = useId();
  const errorId = useId();
  const titleId = useId();
  const comparisonHint = useId();
  const catalog = useQuery({
    queryKey: ["chat-models", scope],
    queryFn: ({ signal }) => api.chatModels(accessToken!, workspaceId!, signal),
    enabled: Boolean(accessToken && workspaceId), retry: false, staleTime: 60_000
  });
  const { turns, live, comparison } = conversation;
  const models = catalog.isError ? [] : catalog.data?.models ?? [];
  const selectedModel = models.find(({ id }) => id === preferredModelId) ?? models.find(({ isDefault }) => isDefault) ?? models[0];
  const alternates = models.filter(({ id }) => id !== selectedModel?.id);
  const alternateModel = alternates.find(({ id }) => id === alternateModelId) ?? alternates[0];
  const comparisonAvailable = Boolean(catalog.data?.comparisonAvailable && selectedModel && alternateModel);
  const autoAvailable = Boolean(catalog.data?.autoAvailable && !catalog.isError);
  const comparing = compareMode && comparisonAvailable;
  const autoSelected = autoAvailable && !comparing && preferredModelId === "auto";
  const isStreaming = live.phase !== null;
  const busy = isStreaming || comparison.isPending || turns.some((turn) => turn.status === "pending");
  const Heading = embedded ? "h3" : "h1";

  const modelOptions = (available: typeof models) => available.map(({ id, label, isDefault }) => ({
    value: id, label, description: isDefault ? t("Workspace default", "Padrão do espaço") : undefined
  }));

  function updateQuestion(value: string) {
    setQuestion(value);
    setInvalidInput(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !question.trim()) return;
    if (comparing && selectedModel && alternateModel && accessToken && workspaceId) {
      const parsed = questionComparisonInputSchema.safeParse({ question: question.trim(), topK, modelIds: [selectedModel.id, alternateModel.id] });
      if (!parsed.success) { setInvalidInput(true); return; }
      conversation.startComparison(parsed.data);
      setCompareMode(false);
    } else {
      const parsed = questionInputSchema.safeParse({ question: question.trim(), topK, modelId: autoSelected ? "auto" : selectedModel?.id });
      if (!parsed.success) { setInvalidInput(true); return; }
      conversation.startAnswer(parsed.data);
    }
    updateQuestion("");
    composer.current?.focus({ preventScroll: true });
  }

  function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey ||
      event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    if (!busy && question.trim()) event.currentTarget.form?.requestSubmit();
  }

  function newChat() {
    conversation.newConversation();
    updateQuestion("");
    setCompareMode(false);
    composer.current?.focus({ preventScroll: true });
  }

  return <section aria-labelledby={titleId} className={`flex w-full min-w-0 flex-col rounded-2xl border border-slate-700/80 bg-slate-950/65 shadow-2xl shadow-slate-950/40 sm:rounded-3xl ${embedded ? "h-[38rem] max-h-[85svh] min-h-[30rem]" : "h-[clamp(31rem,76svh,49rem)] lg:h-[calc(100svh-7rem)] lg:min-h-[31rem]"}`}>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-3 py-3 sm:px-5 sm:py-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-400/10 sm:size-12">
          <Mascot decorative size="sm" className="size-9 sm:size-10" />
        </div>
        <div className="min-w-0">
          <Heading id={titleId} className="text-base font-semibold tracking-tight text-white sm:text-lg">{t("Chat with Milo", "Converse com o Milo")}</Heading>
          <p className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-slate-300">
            <span className="size-1.5 shrink-0 rounded-full bg-cyan-300" aria-hidden="true" />
            <span className="truncate" title={workspaceName}>{workspaceName ?? t("Demo workspace", "Espaço de demonstração")}</span>
          </p>
        </div>
      </div>
      <button className="secondary-button min-w-11 shrink-0 px-2.5 sm:px-3" type="button" disabled={busy} onClick={newChat} title={t("New chat", "Nova conversa")}>
        <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 4.5H5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 16.5h9a1.5 1.5 0 0 0 1.5-1.5v-4m-7 1 .5-3.5L14.2 3.3a1.4 1.4 0 0 1 2 2L11 10.5 8.5 12Z" />
        </svg>
        <span className="sr-only min-[375px]:not-sr-only">{t("New chat", "Nova conversa")}</span>
      </button>
    </header>
    <ConversationThread turns={turns} live={live} demo={!accessToken} suggestions={suggestions} onSuggestion={(message) => {
      updateQuestion(message);
      composer.current?.focus();
    }} />
    <form className="shrink-0 space-y-2 rounded-b-2xl border-t border-slate-800 bg-slate-900/70 p-3 sm:space-y-3 sm:rounded-b-3xl sm:p-4" onSubmit={submit}>
      {selectedModel && (models.length === 1 && !autoAvailable
        ? <p className="text-xs text-slate-300 [overflow-wrap:anywhere]">{t("Workspace answer model", "Modelo de resposta do espaço")} · {selectedModel.label}</p>
        : <fieldset className={`grid min-w-0 items-end gap-2.5 sm:flex sm:flex-wrap sm:gap-3 ${comparisonAvailable ? "grid-cols-2" : "grid-cols-1"}`}>
          <legend className="sr-only">{t("Answer models", "Modelos de resposta")}</legend>
          <SelectField className="sm:min-w-28 sm:max-w-56 sm:flex-1" label={comparing ? t("First model", "Primeiro modelo") : t("Answer model", "Modelo de resposta")}
            value={autoSelected ? "auto" : selectedModel.id} onValueChange={setPreferredModelId} disabled={busy}
            options={autoAvailable && !comparing ? [{ value: "auto", label: t("Automatic", "Automático"),
              description: t("Selects an allowed model by question complexity.", "Escolhe um modelo permitido pela complexidade da pergunta.") }, ...modelOptions(models)] : modelOptions(models)} />
          {comparing && alternateModel && <SelectField className="sm:min-w-28 sm:max-w-56 sm:flex-1" label={t("Second model", "Segundo modelo")}
            value={alternateModel.id} onValueChange={setAlternateModelId} disabled={busy} options={modelOptions(alternates)} />}
          {comparisonAvailable && <label className={`flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-2 py-2 text-xs text-slate-200 sm:text-sm ${comparing ? "col-span-2" : ""} ${busy ? "cursor-not-allowed" : "cursor-pointer transition-colors hover:bg-slate-800"}`}>
            <input type="checkbox" className="size-4 shrink-0 accent-cyan-300" checked={comparing} disabled={busy}
              aria-describedby={comparisonHint} onChange={(event) => setCompareMode(event.target.checked)} />
            {t("Compare two models", "Comparar dois modelos")}
          </label>}
        </fieldset>)}
      {comparisonAvailable && <p id={comparisonHint} className={comparing ? "text-xs leading-5 text-slate-300" : "sr-only"}>
        {t("Both models use the same passages. This counts as two questions toward your daily limit.",
          "Os dois modelos usam os mesmos trechos. A comparação conta como duas perguntas no limite diário.")}
      </p>}
      {catalog.isError && !(catalog.error instanceof ApiError && catalog.error.status === 404) && <p className="text-xs text-slate-300" role="status">
        {t("Model options are unavailable. Milo will use the workspace default.", "As opções de modelo estão indisponíveis. O Milo vai usar o padrão do espaço.")}
      </p>}
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={composerId} className="sr-only">{t("What would you like to know?", "O que você gostaria de saber?")}</label>
          <textarea id={composerId} ref={composer} value={question} maxLength={5000} rows={1}
            aria-invalid={invalidInput || undefined} aria-describedby={invalidInput ? `${hintId} ${errorId}` : hintId}
            onChange={(event) => updateQuestion(event.target.value)} onKeyDown={handleComposerKey}
            className="field block min-h-11 max-h-24 resize-none rounded-2xl py-3 [field-sizing:content]"
            placeholder={accessToken && turns.length ? t("Write a follow-up…", "Continue a conversa…") : t("Message Milo…", "Escreva para o Milo…")} />
        </div>
        {live.phase === "disconnected" ? <button className="primary-button shrink-0 px-2.5 sm:px-4" type="button" onClick={live.resume} disabled={live.stopping}>
          {t("Reconnect", "Reconectar")}
        </button> : isStreaming ? <button className="secondary-button shrink-0 px-2.5 sm:px-4" type="button" onClick={() => void live.stop()} disabled={live.stopping} aria-busy={live.stopping}>
          {live.stopping ? t("Stopping…", "Interrompendo…") : t("Stop answer", "Parar resposta")}
        </button> : comparison.isPending ? <button className="secondary-button shrink-0 px-2.5 sm:px-4" type="button" onClick={comparison.stop}>
          {t("Stop comparison", "Parar comparação")}
        </button> : <button className="primary-button shrink-0 rounded-2xl px-3" disabled={busy || !question.trim()} type="submit"
          aria-label={comparing ? t("Compare answers", "Comparar respostas") : t("Send message", "Enviar mensagem")}>
          <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m10 15 0-10m-4 4 4-4 4 4" /></svg>
          <span className="hidden sm:inline">{comparing ? t("Compare", "Comparar") : t("Send", "Enviar")}</span>
        </button>}
      </div>
      {live.phase === "disconnected" && <button className="text-action" type="button" onClick={() => void live.stop()} disabled={live.stopping}>
        {t("Stop answer", "Parar resposta")}
      </button>}
      {invalidInput && <p id={errorId} role="alert" className="text-xs text-rose-200">
        {t("Enter a message of up to 5,000 characters.", "Digite uma mensagem de até 5.000 caracteres.")}
      </p>}
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <p id={hintId} className="sr-only text-xs text-slate-400 sm:not-sr-only">
          {t("Enter to send · Shift + Enter for a new line", "Enter para enviar · Shift + Enter para quebrar a linha")}
        </p>
        <details className="group text-xs text-slate-300">
          <summary className="min-h-8 rounded-md px-1 py-2 text-slate-300 hover:text-white">{t("Search options", "Opções de busca")}</summary>
          <SelectField className="mb-1 w-44" label={t("Passages to consider", "Trechos para consultar")}
            value={String(topK)} onValueChange={(value) => setTopK(Number(value))} disabled={busy}
            options={["3", "5", "8"].map((value) => ({ value, label: value }))} />
        </details>
      </div>
    </form>
  </section>;
}
