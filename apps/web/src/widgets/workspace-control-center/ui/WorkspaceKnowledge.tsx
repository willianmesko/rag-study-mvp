import { useQueryIdentity } from "../../../shared/lib/query-identity";
import { privateQueryKey } from "../../../shared/lib/query-keys";
import { useEffect, useRef, useState } from "react";
import type { DocumentFilters as Filters } from "@rag-study/contracts";
import { DemoLibraryDialog } from "../../../features/demo-libraries/index";
import { DocumentFilters } from "../../../features/filter-documents/index";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OriginalDocumentAction } from "../../../features/open-original-document/index";
import { WorkspaceSourceDialog } from "../../../features/workspace-source-upload/index";
import { knowledgeStatusQuery } from "../../../entities/workspace/index";
import { api, type ManagedDocument, type Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";
import { ActionMenu } from "../../../shared/ui/ActionMenu";
import { Overlay } from "../../../shared/ui/Overlay";
import { documentsQuery, ingestionJobsQuery } from "../model/queries";
import { WorkspaceQueryFeedback } from "./WorkspaceQueryFeedback";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

type DocumentAction = { type: "reindex" | "remove"; documentId: string };

export function WorkspaceKnowledge({ workspace, token, onAsk }: { workspace: Workspace; token: string; onAsk?: (question: string) => void }) {
  const userId = useQueryIdentity();
  const { locale, t } = useLocale();
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const queryClient = useQueryClient();
  const workspaceId = workspace.tenantId;
  const canManage = workspace.role !== "viewer";
  const heading = useRef<HTMLHeadingElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>({});
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedFilters(filters), 200);
    return () => window.clearTimeout(timer);
  }, [filters]);
  const hasFilter = Object.values(filters).some((value) => value !== undefined);
  const documentOptions = documentsQuery(token, workspaceId, userId, debouncedFilters);
  const documents = useQuery(documentOptions);
  const unfiltered = useQuery({ ...documentsQuery(token, workspaceId, userId), enabled: hasFilter });
  const selectedDocument = documents.data?.documents.find(({ id }) => id === selectedId) ?? unfiltered.data?.documents.find(({ id }) => id === selectedId);
  const filteredDocuments = documents.data?.documents ?? [];
  const availableDocuments = [...new Map([...(unfiltered.data?.documents ?? []), ...filteredDocuments].map((document) => [document.id, document])).values()];

  function refreshKnowledge() {
    void queryClient.invalidateQueries({ queryKey: documentsQuery(token, workspaceId, userId).queryKey });
    void queryClient.invalidateQueries({ queryKey: ingestionJobsQuery(token, workspaceId, userId).queryKey });
    void queryClient.invalidateQueries({ queryKey: knowledgeStatusQuery(token, workspaceId, userId).queryKey });
  }

  const action = useMutation({
    mutationFn: async ({ type, documentId }: DocumentAction) => {
      if (type === "reindex") await api.reindexDocument(documentId, token, workspaceId);
      else await api.deleteDocument(documentId, token, workspaceId);
    },
    onSuccess: (_, { type, documentId }) => {
      if (type === "remove") {
        setSelectedId((current) => current === documentId ? null : current);
        heading.current?.focus({ preventScroll: true });
      }
      refreshKnowledge();
    }
  });
  const removing = action.variables?.type === "remove";

  function confirmDelete(document: ManagedDocument) {
    if (window.confirm(t(`Remove “${document.title ?? document.source}” and its original file?`, `Remover “${document.title ?? document.source}” e o arquivo original?`))) {
      action.mutate({ type: "remove", documentId: document.id });
    }
  }

  return (
    <div className="space-y-6">
      <WorkspacePageHeader title={t("Documents", "Documentos")} description={t("Your team’s searchable source library.", "Os materiais que sua equipe pode consultar.")} headingRef={heading}>
        <button type="button" className="secondary-button" aria-haspopup="dialog" onClick={() => setDemoOpen(true)}>{t("Demo libraries", "Bibliotecas de exemplo")}</button>
        {canManage && <button type="button" className="primary-button" aria-haspopup="dialog" onClick={() => { setAdded(false); setAdding(true); }}>
          {t("Add documents", "Adicionar documentos")}
        </button>}
      </WorkspacePageHeader>
      {demoOpen && <DemoLibraryDialog token={token} workspaceId={workspaceId} role={workspace.role} onClose={() => setDemoOpen(false)} onImported={refreshKnowledge}
        onAsk={onAsk ? (question) => { setDemoOpen(false); onAsk(question); } : undefined}
        onInspectDocument={(documentId) => { setDemoOpen(false); setFilters({ documentId }); setSelectedId(documentId); }} />}
      {adding && canManage && <WorkspaceSourceDialog token={token} workspaceId={workspaceId} onClose={() => setAdding(false)} onAdded={() => setAdded(true)} />}
      {added && <p className="success-message" role="status">{t("Material received. Follow its progress in Processing.", "Material recebido. Acompanhe o andamento em Processamento.")}</p>}
      <div className="space-y-3">
        <DocumentFilters value={filters} documents={availableDocuments} onChange={setFilters} />
        {documents.data && <p className="text-xs text-slate-400">{number.format(filteredDocuments.length)} {t("shown", "exibidos")}</p>}
        <WorkspaceQueryFeedback query={documents} loading={t("Loading documents…", "Carregando documentos…")}
          failure={t("We could not load documents.", "Não foi possível carregar os documentos.")} />
        {documents.isSuccess && filteredDocuments.length === 0 && <p className="empty-state">{hasFilter ? t("No documents match these filters.", "Nenhum documento corresponde a esses filtros.") : t("No documents are ready for search yet.", "Ainda não há documentos disponíveis para busca.")}</p>}
        {action.isSuccess && <p className="success-message" role="status">{removing
          ? t("Document and original file removed.", "Documento e arquivo original removidos.")
          : t("Index update queued.", "Atualização do índice na fila.")}</p>}
        {action.isError && <p className="error-message" role="alert">{workspaceRequestError(action.error, t, removing
          ? t("We could not delete this document.", "Não foi possível excluir este documento.")
          : t("We could not update the index. Check that the original file is available.", "Não foi possível atualizar o índice. Confira se o arquivo original está disponível."))}</p>}
        <ul className="divide-y divide-slate-800 border-y border-slate-800">
          {filteredDocuments.map((document) => (
            <li className="flex min-w-0 items-center gap-3 py-4" key={document.id}>
                <button className="min-w-0 flex-1 rounded-lg text-left hover:bg-slate-800/40" type="button" aria-haspopup="dialog" onClick={() => setSelectedId(document.id)}>
                  <p className="truncate text-sm font-medium text-slate-100">{document.title ?? document.source}</p>
                  <p className="mt-1 text-xs text-slate-400">{number.format(document.chunkCount)} {document.chunkCount === 1 ? t("passage", "trecho") : t("passages", "trechos")}{document.format && ` · ${document.format.toUpperCase()}`}</p>
                </button>
                <time className="hidden shrink-0 text-xs text-slate-400 sm:block" dateTime={document.updatedAt}>{date.format(new Date(document.updatedAt))}</time>
                <ActionMenu label={t(`Actions for ${document.title ?? document.source}`, `Ações para ${document.title ?? document.source}`)} actions={[
                  { label: t("View details", "Ver detalhes"), onSelect: () => setSelectedId(document.id) },
                  ...(canManage ? [
                    { label: t("Reprocess", "Reprocessar"), onSelect: () => action.mutate({ type: "reindex", documentId: document.id }), disabled: action.isPending },
                    { label: t("Remove", "Remover"), onSelect: () => confirmDelete(document), destructive: true, disabled: action.isPending }
                  ] : [])
                ]} />
            </li>
          ))}
        </ul>
      </div>
      {selectedDocument && <DocumentDetails document={selectedDocument} token={token} workspaceId={workspaceId} onClose={() => { setSelectedId(null); heading.current?.focus({ preventScroll: true }); }} />}
    </div>
  );
}

function DocumentMetadata({ document }: { document: ManagedDocument }) {
  const { locale, t } = useLocale();
  const undetermined = t("Language undetermined", "Idioma não identificado");
  const languages = {
    pt: t("Portuguese", "Português"), en: t("English", "Inglês"), mixed: t("Mixed languages", "Idiomas mistos"),
    unknown: undetermined, und: undetermined
  };
  const format = document.format === "text" ? t("Plain text", "Texto simples")
    : document.format === "markdown" ? "Markdown" : document.format?.toUpperCase();
  const language = document.language ? languages[document.language] : undefined;
  const sections = document.sectionCount === undefined ? undefined
    : `${document.sectionCount.toLocaleString(locale)} ${document.sectionCount === 1 ? t("section", "seção") : t("sections", "seções")}`;
  const metadata = [format, language, sections].filter(Boolean).join(" · ");

  return metadata && <p className="mt-1 break-words text-xs text-slate-400">{metadata}</p>;
}

function DocumentDetails({ document, token, workspaceId, onClose }: { document: ManagedDocument; token: string; workspaceId: string; onClose: () => void }) {
  const userId = useQueryIdentity();
  const { locale, t } = useLocale();
  const chunks = useQuery({
    queryKey: privateQueryKey("document-chunks", userId, workspaceId, document.id, document.updatedAt),
    queryFn: ({ signal }) => api.listDocumentChunks(document.id, token, workspaceId, signal)
  });
  const riskLabel = { high: t("High", "Alto"), medium: t("Medium", "Médio"), low: t("Low", "Baixo") };
  const riskTone = { high: "text-rose-300", medium: "text-amber-300", low: "text-slate-400" };

  return (
    <Overlay side title={document.title ?? document.source} description={t("Document details", "Detalhes do documento")} onClose={onClose}>
      <dl className="grid gap-3 border-b border-slate-800 pb-5 text-sm">
        <div><dt className="text-xs text-slate-400">{t("Source", "Fonte")}</dt><dd className="mt-1 break-words text-slate-200">{document.source}</dd></div>
        <div><dt className="text-xs text-slate-400">{t("Updated", "Atualizado em")}</dt><dd className="mt-1 text-slate-200">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(document.updatedAt))}</dd></div>
      </dl>
      <DocumentMetadata document={document} />
      {document.hasOriginal === true && <OriginalDocumentAction inline documentId={document.id} documentName={document.title ?? document.source} accessToken={token} workspaceId={workspaceId} />}
      <div>
        <h3 className="text-base font-semibold text-slate-100">{t("Document passages", "Trechos do documento")}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-400">{t("One document can produce several passages. Each passage contains part of its text.", "Um documento pode gerar vários trechos. Cada trecho contém uma parte do texto.")}</p>
      </div>
      <WorkspaceQueryFeedback query={chunks} loading={t("Loading passages…", "Carregando trechos…")}
        failure={t("We could not load these passages.", "Não foi possível carregar estes trechos.")} />
      {chunks.isSuccess && chunks.data.chunks.length === 0 && <p className="empty-state">{t("There are no passages for this document.", "Este documento não tem trechos disponíveis.")}</p>}
      <div className="divide-y divide-slate-800">
        {chunks.data?.chunks.map((chunk) => {
          const risk = chunk.security.promptInjectionRisk;
          return <article key={chunk.id} className="py-4 first:pt-0">
            <div className="flex items-center justify-between gap-4">
              <p className="font-mono text-xs text-cyan-300">{t("Passage", "Trecho")} {(chunk.ordinal + 1).toLocaleString(locale)}</p>
              <p className={`text-xs ${riskTone[risk]}`}>{t("Risk", "Risco")} · {riskLabel[risk]}</p>
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{chunk.content}</p>
          </article>;
        })}
      </div>
    </Overlay>
  );
}
