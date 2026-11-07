import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { questionComparisonInputSchema, questionInputSchema } from "@rag-study/contracts";
import { ApiError, api, type Workspace } from "../../../shared/api/rag-api";
import { knowledgeStatusQuery } from "../../../entities/workspace/model/knowledge";
import { useLocale } from "../../../shared/i18n/locale";
import { Mascot } from "../../../shared/ui/Mascot";
import { SelectField } from "../../../shared/ui/SelectField";
import type { useConversation } from "../model/use-conversation";
import { promptVariantLabel } from "../model/prompt-variants";
import { ConversationThread } from "./ConversationThread";
import { KnowledgeChatState } from "./KnowledgeChatState";
import { ConversationLibrary } from "./ConversationLibrary";

export function QuestionAnswerForm({ conversation, accessToken, workspaceId, workspaceName, workspaceRole, onAddDocuments, scope, embedded = false, suggestions, suggestion, onSuggestionUsed }: {
  conversation: ReturnType<typeof useConversation>;
  accessToken?: string | null;
  workspaceId?: string;
  workspaceName?: string;
  workspaceRole?: Workspace["role"];
  onAddDocuments?: () => void;
  scope: string;
  embedded?: boolean;
  suggestions?: string[];
  suggestion?: { id: string; text: string } | null;
  onSuggestionUsed?: () => void;
}) {
  const { t } = useLocale();
  const [question, setQuestion] = useState("");
  const [libraryOpen,setLibraryOpen]=useState(false);
  const [topK, setTopK] = useState(5);
  const [invalidInput, setInvalidInput] = useState(false);
  const [preferredModelId, setPreferredModelId] = useState<string>();
  const [alternateModelId, setAlternateModelId] = useState<string>();
  const [compareMode, setCompareMode] = useState(false);
  const [comparisonKind, setComparisonKind] = useState<"models" | "prompts">("models");
  const [preferredPrompt, setPreferredPrompt] = useState("balanced");
  const [alternatePrompt, setAlternatePrompt] = useState("concise");
  const composer = useRef<HTMLTextAreaElement>(null);
  const composerId = useId();
  const hintId = useId();
  const errorId = useId();
  const titleId = useId();
  const comparisonHint = useId();
  const knowledge = useQuery(knowledgeStatusQuery(accessToken, workspaceId));
  // A cached ready state must not briefly unlock a workspace whose last
  // document was deleted while the user was on another page/device.
  const canAsk = knowledge.isFetchedAfterMount && knowledge.isSuccess && !knowledge.isError && knowledge.data.passages > 0 && !conversation.saved.initializing && !conversation.saved.loading && !(conversation.saved.enabled&&conversation.saved.error);
  const canAdd = Boolean(accessToken && workspaceId && (workspaceRole === "owner" || workspaceRole === "editor"));
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
  const modelComparisonAvailable = Boolean(catalog.data?.comparisonAvailable && selectedModel && alternateModel);
  const prompts = catalog.data?.promptVariants ?? [];
  const promptComparisonAvailable = Boolean(catalog.data?.promptComparisonAvailable && selectedModel && prompts.length >= 2);
  const comparisonAvailable = modelComparisonAvailable || promptComparisonAvailable;
  const kind = comparisonKind === "prompts" ? promptComparisonAvailable ? "prompts" : "models" : modelComparisonAvailable ? "models" : "prompts";
  const firstPrompt = prompts.find(({ id }) => id === preferredPrompt) ?? prompts[0];
  const otherPrompts = prompts.filter(({ id }) => id !== firstPrompt?.id);
  const secondPrompt = otherPrompts.find(({ id }) => id === alternatePrompt) ?? otherPrompts[0];
  const autoAvailable = Boolean(catalog.data?.autoAvailable && !catalog.isError);
  const comparing = compareMode && comparisonAvailable;
  const comparingPrompts = comparing && kind === "prompts";
  const autoSelected = autoAvailable && !comparing && preferredModelId === "auto";
  const isStreaming = live.phase !== null;
  const busy = isStreaming || comparison.isPending || conversation.submitting || turns.some((turn) => turn.status === "pending");
  const Heading = embedded ? "h3" : "h1";
  useEffect(() => {
    if (!suggestion) return;
    setQuestion(suggestion.text.slice(0, 5_000));
    setInvalidInput(false);
    composer.current?.focus({ preventScroll: true });
    onSuggestionUsed?.();
  }, [suggestion, onSuggestionUsed]);

  const modelOptions = (available: typeof models) => available.map(({ id, label, isDefault }) => ({
    value: id, label, description: isDefault ? t("Workspace default", "Padrão do espaço") : undefined
  }));

  function updateQuestion(value: string) {
    setQuestion(value);
    setInvalidInput(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canAsk || !question.trim()) return;
    if (comparing && selectedModel && accessToken && workspaceId) {
      const parsed = questionComparisonInputSchema.safeParse({ question: question.trim(), topK,
        modelIds: [selectedModel.id, comparingPrompts ? selectedModel.id : alternateModel?.id],
        ...(comparingPrompts ? { promptVariantIds: [firstPrompt?.id, secondPrompt?.id] } : {}) });
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
          <Heading id={titleId} className="truncate text-base font-semibold tracking-tight text-white sm:text-lg">{conversation.saved.conversation?.title??t("Chat with Milo", "Converse com o Milo")}</Heading>
          <p className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-slate-300">
            <span className="size-1.5 shrink-0 rounded-full bg-cyan-300" aria-hidden="true" />
            <span className="truncate" title={workspaceName}>{workspaceName ?? t("Demo workspace", "Espaço de demonstração")}</span>
          </p>
        </div>
      </div>
      {conversation.saved.enabled&&<button className="secondary-button min-h-11 min-w-11 px-3" type="button" disabled={busy} onClick={()=>setLibraryOpen(true)}>
        <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3.5h12a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H7l-4.5 3V5A1.5 1.5 0 0 1 4 3.5Z"/><path d="M6 7h8M6 10.5h5"/></svg>
        <span className="sr-only sm:not-sr-only">{t('Chats','Conversas')}</span>
      </button>}
      <button className="secondary-button min-w-11 shrink-0 px-2.5 sm:px-3" type="button" disabled={busy || turns.length === 0} onClick={newChat} title={t("New chat", "Nova conversa")}>
        <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 4.5H5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 16.5h9a1.5 1.5 0 0 0 1.5-1.5v-4m-7 1 .5-3.5L14.2 3.3a1.4 1.4 0 0 1 2 2L11 10.5 8.5 12Z" />
        </svg>
        <span className={conversation.saved.enabled?"sr-only sm:not-sr-only":"sr-only min-[375px]:not-sr-only"}>{t("New chat", "Nova conversa")}</span>
      </button>
    </header>
    {conversation.saved.enabled&&<p className="px-4 pt-2 text-xs text-slate-400">{t('Private to you · saved across devices','Privada para você · salva entre dispositivos')}</p>}
    {conversation.saved.enabled&&conversation.saved.error&&<p role="alert" className="error-message mx-3 mt-3">{t('We could not load or save this conversation. Try again before sending a message.','Não conseguimos carregar ou salvar esta conversa. Tente novamente antes de enviar uma mensagem.')} <button type="button" className="text-action" onClick={conversation.saved.retry}>{t('Try again','Tentar novamente')}</button> <button type="button" className="text-action" onClick={newChat}>{t('New chat','Nova conversa')}</button></p>}
    {conversation.saved.loading&&<p role="status" className="p-4 text-sm text-slate-300">{t('Opening your conversation…','Abrindo sua conversa…')}</p>}
    {(canAsk || busy || turns.length > 0) && <ConversationThread turns={turns} live={live} demo={!accessToken} saved={conversation.saved} suggestions={suggestions} onSuggestion={(message) => {
      updateQuestion(message);
      composer.current?.focus();
    }} />}
    {!canAsk && !busy && !conversation.saved.loading && <KnowledgeChatState data={knowledge.data} loading={conversation.saved.initializing || knowledge.isPending || (!knowledge.isFetchedAfterMount && !knowledge.isError)} failed={knowledge.isError}
      demo={!accessToken} canAdd={canAdd} onAdd={onAddDocuments} onRetry={() => void knowledge.refetch()} compact={turns.length > 0} />}
    {(canAsk || busy) && <form className="shrink-0 space-y-2 rounded-b-2xl border-t border-slate-800 bg-slate-900/70 p-3 sm:space-y-3 sm:rounded-b-3xl sm:p-4" onSubmit={submit}>
      {canAsk && knowledge.data.processingJobs > 0 && <p className="text-xs leading-5 text-slate-300" role="status">
        {t("More documents are being prepared. You can chat using the sources that are already ready.", "Mais documentos estão sendo preparados. Você já pode conversar usando as fontes disponíveis.")}
      </p>}
      {selectedModel && (models.length === 1 && !autoAvailable && !comparisonAvailable
        ? <p className="text-xs text-slate-300 [overflow-wrap:anywhere]">{t("Workspace answer model", "Modelo de resposta do espaço")} · {selectedModel.label}</p>
        : <fieldset className={`grid min-w-0 items-end gap-2.5 sm:flex sm:flex-wrap sm:gap-3 ${comparisonAvailable ? "grid-cols-2" : "grid-cols-1"}`}>
          <legend className="sr-only">{t("Answer models", "Modelos de resposta")}</legend>
          <SelectField className="sm:min-w-28 sm:max-w-56 sm:flex-1" label={comparing && !comparingPrompts ? t("First model", "Primeiro modelo") : t("Answer model", "Modelo de resposta")}
            value={autoSelected ? "auto" : selectedModel.id} onValueChange={setPreferredModelId} disabled={busy || (models.length === 1 && !autoAvailable)}
            options={autoAvailable && !comparing ? [{ value: "auto", label: t("Automatic", "Automático"),
              description: t("Selects an allowed model by question complexity.", "Escolhe um modelo permitido pela complexidade da pergunta.") }, ...modelOptions(models)] : modelOptions(models)} />
          {comparing && !comparingPrompts && alternateModel && <SelectField className="sm:min-w-28 sm:max-w-56 sm:flex-1" label={t("Second model", "Segundo modelo")}
            value={alternateModel.id} onValueChange={setAlternateModelId} disabled={busy} options={modelOptions(alternates)} />}
          {comparisonAvailable && <label className={`flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-2 py-2 text-xs text-slate-200 sm:text-sm ${comparing ? "col-span-2" : ""} ${busy ? "cursor-not-allowed" : "cursor-pointer transition-colors hover:bg-slate-800"}`}>
            <input type="checkbox" className="size-4 shrink-0 accent-cyan-300" checked={comparing} disabled={busy}
              aria-describedby={comparisonHint} onChange={(event) => setCompareMode(event.target.checked)} />
            {kind === "prompts" ? t("Compare prompts", "Comparar prompts") : t("Compare two models", "Comparar dois modelos")}
          </label>}
          {comparing && promptComparisonAvailable && modelComparisonAvailable && <SelectField label={t("Compare", "Comparar")}
            value={kind} onValueChange={(value) => setComparisonKind(value === "prompts" ? "prompts" : "models")} disabled={busy}
            options={[{ value: "models", label: t("Two models", "Dois modelos") }, { value: "prompts", label: t("Two prompts", "Dois prompts") }]} />}
          {comparingPrompts && firstPrompt && secondPrompt && <>
            <SelectField label={t("First prompt", "Primeiro prompt")} value={firstPrompt.id} onValueChange={setPreferredPrompt} disabled={busy}
              options={prompts.map(({ id }) => ({ value: id, label: promptVariantLabel(id, t) }))} />
            <SelectField label={t("Second prompt", "Segundo prompt")} value={secondPrompt.id} onValueChange={setAlternatePrompt} disabled={busy}
              options={otherPrompts.map(({ id }) => ({ value: id, label: promptVariantLabel(id, t) }))} />
          </>}
        </fieldset>)}
      {comparisonAvailable && <p id={comparisonHint} className={comparing ? "text-xs leading-5 text-slate-300" : "sr-only"}>
        {comparingPrompts ? t("The same model answers twice using the same passages and two approved prompts. This counts as two questions.",
          "O mesmo modelo responde duas vezes com os mesmos trechos e dois prompts aprovados. A comparação conta como duas perguntas.")
          : t("Both models use the same passages. This counts as two questions toward your daily limit.",
            "Os dois modelos usam os mesmos trechos. A comparação conta como duas perguntas no limite diário.")}
      </p>}
      {catalog.isError && !(catalog.error instanceof ApiError && catalog.error.status === 404) && <p className="text-xs text-slate-300" role="status">
        {t("Model options are unavailable. Milo will use the workspace default.", "As opções de modelo estão indisponíveis. O Milo vai usar o padrão do espaço.")}
      </p>}
      <div className="flex items-end gap-2">
        {canAdd && onAddDocuments && <button className="secondary-button min-w-11 shrink-0 px-3" type="button" onClick={onAddDocuments} disabled={busy}
          aria-label={t("Add documents", "Adicionar documentos")} title={t("Add documents to this workspace", "Adicionar documentos a este espaço")} aria-haspopup="dialog">
          <svg aria-hidden="true" className="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m7 11 6-6a2.1 2.1 0 0 1 3 3l-7.5 7.5a3.5 3.5 0 0 1-5-5L11 3a2.1 2.1 0 0 1 3 0" /></svg>
        </button>}
        <div className="min-w-0 flex-1">
          <label htmlFor={composerId} className="sr-only">{t("What would you like to know?", "O que você gostaria de saber?")}</label>
          <textarea id={composerId} ref={composer} value={question} maxLength={5000} rows={1}
            aria-invalid={invalidInput || undefined} aria-describedby={invalidInput ? `${hintId} ${errorId}` : hintId}
            onChange={(event) => updateQuestion(event.target.value)} onKeyDown={handleComposerKey} disabled={!canAsk}
            className="field block min-h-11 max-h-24 resize-none rounded-2xl py-3 [field-sizing:content]"
            placeholder={accessToken && turns.length ? t("Write a follow-up…", "Continue a conversa…") : t("Message Milo…", "Escreva para o Milo…")} />
        </div>
        {live.phase === "disconnected" ? <button className="primary-button shrink-0 px-2.5 sm:px-4" type="button" onClick={live.resume} disabled={live.stopping}>
          {t("Reconnect", "Reconectar")}
        </button> : isStreaming ? <button className="secondary-button shrink-0 px-2.5 sm:px-4" type="button" onClick={() => void live.stop()} disabled={live.stopping} aria-busy={live.stopping}>
          {live.stopping ? t("Stopping…", "Interrompendo…") : t("Stop answer", "Parar resposta")}
        </button> : comparison.isPending ? <button className="secondary-button shrink-0 px-2.5 sm:px-4" type="button" onClick={comparison.stop}>
          {t("Stop comparison", "Parar comparação")}
        </button> : <button className="primary-button shrink-0 rounded-2xl px-3" disabled={busy || !canAsk || !question.trim()} type="submit"
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
    </form>}
    {libraryOpen&&<ConversationLibrary saved={conversation.saved} onOpen={conversation.saved.open} onClose={()=>setLibraryOpen(false)}/>}
  </section>;
}
