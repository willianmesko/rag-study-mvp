import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OriginalDocumentAction } from "../../../features/open-original-document/ui/OriginalDocumentAction";
import { UrlImportForm } from "../../../features/workspace-source-upload/ui/UrlImportForm";
import { WorkspaceFileUpload } from "../../../features/workspace-source-upload/ui/WorkspaceFileUpload";
import { api, type ManagedDocument, type Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";
import { ActionMenu } from "../../../shared/ui/ActionMenu";
import { Overlay } from "../../../shared/ui/Overlay";
import { documentsQuery, ingestionJobsQuery } from "../model/queries";
import { WorkspaceQueryFeedback } from "./WorkspaceQueryFeedback";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

type DocumentAction = { type: "reindex" | "remove"; documentId: string };

export function WorkspaceKnowledge({ workspace, token }: { workspace: Workspace; token: string }) {
  const { locale, t } = useLocale();
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const queryClient = useQueryClient();
  const workspaceId = workspace.tenantId;
  const canManage = workspace.role !== "viewer";
  const heading = useRef<HTMLHeadingElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [sourceType, setSourceType] = useState<"file" | "url">("file");
  const [uploading, setUploading] = useState(false);
  const [added, setAdded] = useState(false);
  const [documentFilter, setDocumentFilter] = useState("");
  const documentOptions = documentsQuery(token, workspaceId);
  const documents = useQuery(documentOptions);
  const selectedDocument = documents.data?.documents.find(({ id }) => id === selectedId);
  const filter = documentFilter.trim().toLocaleLowerCase(locale);
  const filteredDocuments = (documents.data?.documents ?? []).filter(({ title, source }) =>
    [title, source].join(" ").toLocaleLowerCase(locale).includes(filter));

  function refreshKnowledge() {
    void queryClient.invalidateQueries({ queryKey: documentOptions.queryKey });
    void queryClient.invalidateQueries({ queryKey: ingestionJobsQuery(token, workspaceId).queryKey });
  }

  function materialAdded() {
    refreshKnowledge();
    setAdding(false);
    setAdded(true);
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
        {canManage && <button type="button" className="primary-button" aria-haspopup="dialog" onClick={() => { setUploading(false); setAdded(false); setAdding(true); }}>
          {t("Add documents", "Adicionar documentos")}
        </button>}
      </WorkspacePageHeader>
      {adding && canManage && <Overlay title={t("Add documents", "Adicionar documentos")} pending={uploading} onClose={() => setAdding(false)}>
        <div className="flex gap-2" role="group" aria-label={t("Source type", "Tipo de material")}>
          <button type="button" className={sourceType === "file" ? "primary-button" : "secondary-button"} aria-pressed={sourceType === "file"} disabled={uploading} onClick={() => setSourceType("file")}>{t("File", "Arquivo")}</button>
          <button type="button" className={sourceType === "url" ? "primary-button" : "secondary-button"} aria-pressed={sourceType === "url"} disabled={uploading} onClick={() => setSourceType("url")}>{t("Web page", "Página da web")}</button>
        </div>
        {sourceType === "file"
          ? <WorkspaceFileUpload token={token} workspaceId={workspaceId} onUploaded={materialAdded} onPendingChange={setUploading} />
          : <UrlImportForm accessToken={token} workspaceId={workspaceId} onImported={materialAdded} onPendingChange={setUploading} />}
      </Overlay>}
      {added && <p className="success-message" role="status">{t("Material received. Follow its progress in Processing.", "Material recebido. Acompanhe o andamento em Processamento.")}</p>}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input className="field w-full sm:w-72" aria-label={t("Filter documents", "Filtrar documentos")} value={documentFilter}
            onChange={(event) => setDocumentFilter(event.target.value)} placeholder={t("Find a document…", "Encontrar um documento…")} />
          {documents.data && <span className="text-xs text-slate-400">{number.format(filteredDocuments.length)} {t("shown", "exibidos")}</span>}
        </div>
        <WorkspaceQueryFeedback query={documents} loading={t("Loading documents…", "Carregando documentos…")}
          failure={t("We could not load documents.", "Não foi possível carregar os documentos.")} />
        {documents.isSuccess && filteredDocuments.length === 0 && <p className="empty-state">{filter ? t("No documents match this filter.", "Nenhum documento corresponde a esse filtro.") : t("No documents are ready for search yet.", "Ainda não há documentos disponíveis para busca.")}</p>}
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
      {selectedDocument && <DocumentDetails document={selectedDocument} token={token} workspaceId={workspaceId} onClose={() => setSelectedId(null)} />}
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
  const { locale, t } = useLocale();
  const chunks = useQuery({
    queryKey: ["document-chunks", token, workspaceId, document.id, document.updatedAt],
    queryFn: () => api.listDocumentChunks(document.id, token, workspaceId)
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
