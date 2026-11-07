import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DemoLibrary, DemoSourceState } from "@rag-study/contracts";
import { api, type Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";
import { Overlay } from "../../../shared/ui/Overlay";
import { SelectField } from "../../../shared/ui/SelectField";

export function DemoLibraryDialog({ token, workspaceId, role, initialId = "knowledge", onClose, onImported, onAsk, onInspectDocument }: {
  token: string;
  workspaceId: string;
  role: Workspace["role"];
  initialId?: DemoLibrary["id"];
  onClose: () => void;
  onImported: () => void;
  onAsk?: (question: string) => void;
  onInspectDocument?: (documentId: string) => void;
}) {
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
  const key = ["demo-libraries", token, workspaceId, locale] as const;
  const [selectedId, setSelectedId] = useState(initialId);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [stopped, setStopped] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const catalog = useQuery({
    queryKey: key, queryFn: ({ signal }) => api.demoLibraries(token, workspaceId, locale, signal), retry: false,
    refetchInterval: (query) => query.state.data?.states.some(({ state }) => state === "queued" || state === "processing") ? 3_000 : false
  });
  const selected = catalog.data?.libraries.find(({ id }) => id === selectedId) ?? catalog.data?.libraries[0];
  const states = new Map(catalog.data?.states.map((state) => [state.source, state]));
  const canAdd = role !== "viewer";
  const remaining = selected?.documents.filter(({ source }) => !["ready", "queued", "processing"].includes(states.get(source)?.state ?? "missing")) ?? [];
  const ready = selected?.documents.every(({ source }) => states.get(source)?.state === "ready");
  const seed = useMutation({
    mutationFn: async (library: DemoLibrary) => {
      const execution = new AbortController();
      controller.current = execution;
      setStopped(false);
      setProgress({ done: 0, total: library.documents.length });
      for (const [index, document] of library.documents.entries()) {
        execution.signal.throwIfAborted();
        const result = await api.seedDemoDocument(token, workspaceId, library.id, document.id, locale, execution.signal);
        queryClient.setQueryData<Awaited<ReturnType<typeof api.demoLibraries>>>(key, (current) => current && ({
          ...current, states: [...current.states.filter(({ source }) => source !== result.state.source), result.state]
        }));
        setProgress({ done: index + 1, total: library.documents.length });
      }
    },
    onSettled: () => { controller.current = null; void queryClient.invalidateQueries({ queryKey: key, exact: true }); onImported(); }
  });
  useEffect(() => () => controller.current?.abort(), []);

  const labels: Record<DemoSourceState["state"], string> = {
    missing: t("Not added", "Não adicionado"), queued: t("Queued", "Na fila"), processing: t("Preparing", "Preparando"),
    failed: t("Needs another attempt", "Precisa de nova tentativa"), ready: t("Ready", "Pronto")
  };

  function download(document: DemoLibrary["documents"][number]) {
    const url = URL.createObjectURL(new Blob([document.content], { type: { markdown: "text/markdown", text: "text/plain", html: "text/html" }[document.format] }));
    const link = window.document.createElement("a");
    link.href = url; link.download = document.filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  return <Overlay title={t("Demonstration libraries", "Bibliotecas de demonstração")} pending={seed.isPending} onClose={onClose}
    description={t("Explore fictional materials with questions and supporting sources. Add them only to a workspace where you want demonstration content.",
      "Explore materiais fictícios com perguntas e fontes de apoio. Adicione-os a um espaço em que você queira conteúdo de demonstração.")}>
    {catalog.isPending && <p role="status" className="text-sm text-slate-300">{t("Loading libraries…", "Carregando bibliotecas…")}</p>}
    {catalog.isError && <div className="space-y-3">
      <p role="alert" className="error-message">{getRequestErrorMessage(catalog.error, locale)}</p>
      <button className="secondary-button" type="button" onClick={() => void catalog.refetch()}>{t("Try again", "Tentar novamente")}</button>
    </div>}
    {selected && <>
      <SelectField label={t("Library", "Biblioteca")} value={selected.id} disabled={seed.isPending}
        onValueChange={(id) => { setSelectedId(id as DemoLibrary["id"]); seed.reset(); setStopped(false); setProgress({ done: 0, total: 0 }); }}
        options={(catalog.data?.libraries ?? []).map(({ id, title, description }) => ({ value: id, label: title, description }))} />
      <div className="space-y-2">
        <p className="text-sm leading-6 text-slate-300">{selected.description}</p>
        <p className="text-xs leading-5 text-slate-400">{t(`Version ${selected.version} · ${selected.documents.length} files · ${Math.ceil(selected.documents.reduce((sum, document) => sum + document.bytes, 0) / 1024)} KB`,
          `Versão ${selected.version} · ${selected.documents.length} arquivos · ${Math.ceil(selected.documents.reduce((sum, document) => sum + document.bytes, 0) / 1024)} KB`)}</p>
      </div>
      {canAdd ? <div className="space-y-3">
        <p className="text-xs leading-5 text-slate-300">{t("Adding files uses your normal upload quota and configured AI provider for preparation. Sources already added or queued are skipped.",
          "Adicionar arquivos usa sua quota normal de envio e o provedor de IA configurado para o processamento. Fontes já adicionadas ou na fila são ignoradas.")}</p>
        <div className="flex flex-wrap gap-2">
          <button className="primary-button" type="button" disabled={seed.isPending || remaining.length === 0} onClick={() => seed.mutate(selected)}>
            {seed.isPending ? t("Adding files…", "Adicionando arquivos…") : ready ? t("Library added", "Biblioteca adicionada") : remaining.length === 0
              ? t("Preparing files…", "Preparando arquivos…") : t("Add library to this workspace", "Adicionar biblioteca a este espaço")}
          </button>
          {seed.isPending && <button className="secondary-button" type="button" onClick={() => { setStopped(true); controller.current?.abort(); }}>{t("Stop adding files", "Parar de adicionar arquivos")}</button>}
        </div>
        {progress.total > 0 && <p role="status" className="text-xs text-slate-300">{t(`${progress.done}/${progress.total} files checked. Accepted files continue processing in this workspace.`,
          `${progress.done}/${progress.total} arquivos conferidos. Arquivos recebidos continuam sendo processados neste espaço.`)}</p>}
        {seed.isError && (stopped ? <p role="status" className="text-sm text-slate-300">{t("Stopped adding more files. Check the source statuses before continuing.", "O envio de novos arquivos foi interrompido. Confira os status das fontes antes de continuar.")}</p>
          : <p role="alert" className="error-message">{getRequestErrorMessage(seed.error, locale)}</p>)}
      </div> : <p className="text-sm text-slate-300">{t("An owner or editor can add these files. You can preview them and use questions once their sources are ready.", "Um proprietário ou editor pode adicionar estes arquivos. Você pode ler as prévias e usar perguntas quando as fontes estiverem prontas.")}</p>}
      <section className="space-y-3" aria-label={t("Library sources", "Fontes da biblioteca")}>
        <h3 className="font-semibold text-slate-100">{t("Sources", "Fontes")}</h3>
        <ul className="divide-y divide-slate-800 border-y border-slate-800">
          {selected.documents.map((document) => {
            const state = states.get(document.source);
            return <li key={document.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-words text-sm font-medium text-slate-100">{document.title}</p>
                <span className="text-xs text-slate-300">{labels[state?.state ?? "missing"]}</span>
              </div>
              <p className="text-xs text-slate-400">{document.format.toUpperCase()} · {document.language === "pt" ? t("Portuguese", "Português") : t("English", "Inglês")}</p>
              <details className="text-xs text-slate-300">
                <summary className="min-h-11 w-fit rounded-md py-3 text-cyan-200">{t("Preview source", "Ver prévia da fonte")}</summary>
                <p className="my-2 break-all font-mono text-slate-400">{document.source}</p>
                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 leading-6 [overflow-wrap:anywhere]">{document.preview ?? document.content}</pre>
              </details>
              <div className="flex flex-wrap gap-3">
                <button className="text-action min-h-11" type="button" onClick={() => download(document)}>{t("Download sample", "Baixar exemplo")}</button>
                {state?.documentId && onInspectDocument && <button className="text-action min-h-11" type="button" onClick={() => onInspectDocument(state.documentId!)}>{t("Open added document", "Abrir documento adicionado")}</button>}
              </div>
            </li>;
          })}
        </ul>
      </section>
      <section className="space-y-3" aria-label={t("Suggested questions", "Perguntas sugeridas")}>
        <h3 className="font-semibold text-slate-100">{t("Try a question", "Experimente uma pergunta")}</h3>
        <ul className="divide-y divide-slate-800">
          {selected.questions.map(({ question, expectedSources }) => {
            const available = expectedSources.every((source) => states.get(source)?.state === "ready");
            return <li key={question} className="space-y-2 py-3">
              <p className="text-sm text-slate-100">{question}</p>
              <p className="text-xs leading-5 text-slate-400">{t("Supporting sources", "Fontes de apoio")} · {expectedSources.map((source) => selected.documents.find((document) => document.source === source)?.title ?? source).join("; ")}</p>
              {onAsk && <button className="secondary-button" type="button" disabled={!available || seed.isPending} onClick={() => onAsk(question)}>{t("Ask this question", "Fazer esta pergunta")}</button>}
              {!available && <p className="text-xs text-slate-400">{t("Available after the supporting sources are ready.", "Disponível quando as fontes de apoio estiverem prontas.")}</p>}
            </li>;
          })}
        </ul>
      </section>
    </>}
  </Overlay>;
}
