import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OriginalDocumentAction } from "../../../features/open-original-document/ui/OriginalDocumentAction";
import { UrlImportForm } from "../../../features/workspace-source-upload/ui/UrlImportForm";
import { WorkspaceFileUpload } from "../../../features/workspace-source-upload/ui/WorkspaceFileUpload";
import { api, type ManagedDocument, type Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";
import { documentsQuery, ingestionJobsQuery } from "../model/queries";
import { WorkspaceQueryFeedback } from "./WorkspaceQueryFeedback";

type DocumentAction = { type: "reindex" | "remove"; documentId: string };

export function WorkspaceKnowledge({ workspace, token }: { workspace: Workspace; token: string }) {
  const { locale, t } = useLocale();
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const queryClient = useQueryClient();
  const workspaceId = workspace.tenantId;
  const canManage = workspace.role !== "viewer";
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const action = useMutation({
    mutationFn: async ({ type, documentId }: DocumentAction) => {
      if (type === "reindex") await api.reindexDocument(documentId, token, workspaceId);
      else await api.deleteDocument(documentId, token, workspaceId);
    },
    onSuccess: (_, { type, documentId }) => {
      if (type === "remove") setSelectedId((current) => current === documentId ? null : current);
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
      {canManage && <div className="grid gap-4 xl:grid-cols-2">
        <WorkspaceFileUpload token={token} workspaceId={workspaceId} onUploaded={refreshKnowledge} />
        <UrlImportForm accessToken={token} workspaceId={workspaceId} onImported={refreshKnowledge} />
      </div>}
      <div className="space-y-3">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">{t("Knowledge library", "Biblioteca de documentos")}</p>
            <h3 className="mt-2 text-lg font-semibold text-white">{t("Searchable documents", "Documentos disponíveis para busca")}</h3>
            <p className="mt-2 text-sm text-slate-400">{t("Open a document to inspect the passages used in search.", "Abra um documento para conferir os trechos usados na busca.")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input className="field w-full sm:w-56" aria-label={t("Filter documents", "Filtrar documentos")} value={documentFilter}
              onChange={(event) => setDocumentFilter(event.target.value)} placeholder={t("Filter documents…", "Filtrar documentos…")} />
            {documents.data && <span className="status-pill">{number.format(filteredDocuments.length)} {t("shown", "exibidos")}</span>}
          </div>
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
        <div className="grid gap-3">
          {filteredDocuments.map((document) => (
            <article className={"min-w-0 rounded-xl border p-4 transition duration-200 hover:-translate-y-0.5 " + (selectedId === document.id ? "border-cyan-400/50 bg-cyan-400/5" : "border-slate-800 bg-slate-900/30")} key={document.id}>
              <div className="flex flex-col justify-between gap-4 sm:flex-row">
                <button className="min-w-0 text-left" type="button" onClick={() => setSelectedId(document.id)}>
                  <p className="truncate text-sm font-medium text-slate-100">{document.title ?? document.source}</p>
                  <p className="mt-1 truncate font-mono text-xs text-slate-500">{document.source}</p>
                  <p className="mt-2 text-xs text-slate-400">{number.format(document.chunkCount)} {document.chunkCount === 1 ? t("passage", "trecho") : t("passages", "trechos")} · {t("updated", "atualizado em")} {date.format(new Date(document.updatedAt))}</p>
                  <DocumentMetadata document={document} />
                </button>
                <div className="flex shrink-0 flex-wrap items-start gap-3 text-xs font-medium">
                  <button type="button" className="text-cyan-300 hover:text-cyan-100" onClick={() => setSelectedId(document.id)}>{t("View passages", "Ver trechos")}</button>
                  {document.hasOriginal === true && <OriginalDocumentAction documentId={document.id} documentName={document.title ?? document.source}
                    accessToken={token} workspaceId={workspaceId} />}
                  {canManage && <>
                    <button type="button" className="text-violet-300 hover:text-violet-100" onClick={() => action.mutate({ type: "reindex", documentId: document.id })} disabled={action.isPending}>{t("Refresh index", "Atualizar índice")}</button>
                    <button type="button" className="text-rose-300 hover:text-rose-100" onClick={() => confirmDelete(document)} disabled={action.isPending}>{t("Delete", "Excluir")}</button>
                  </>}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
      {selectedDocument && <DocumentPassages document={selectedDocument} token={token} workspaceId={workspaceId} onClose={() => setSelectedId(null)} />}
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

function DocumentPassages({ document, token, workspaceId, onClose }: { document: ManagedDocument; token: string; workspaceId: string; onClose: () => void }) {
  const { locale, t } = useLocale();
  const chunks = useQuery({
    queryKey: ["document-chunks", token, workspaceId, document.id, document.updatedAt],
    queryFn: () => api.listDocumentChunks(document.id, token, workspaceId)
  });
  const riskLabel = { high: t("High", "Alto"), medium: t("Medium", "Médio"), low: t("Low", "Baixo") };
  const riskTone = { high: "text-rose-300", medium: "text-amber-300", low: "text-emerald-300" };

  return (
    <section className="panel space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{t("Document passages", "Trechos do documento")}</p>
          <h3 className="mt-2 break-words text-lg font-semibold text-white">{document.title ?? document.source}</h3>
          <p className="mt-2 text-sm text-slate-400">{t("See the original text and the result of the safety check.", "Veja o texto original e o resultado da verificação de segurança.")}</p>
        </div>
        <button type="button" className="text-xs text-slate-400 hover:text-white" onClick={onClose}>{t("Close", "Fechar")}</button>
      </div>
      <WorkspaceQueryFeedback query={chunks} loading={t("Loading passages…", "Carregando trechos…")}
        failure={t("We could not load these passages.", "Não foi possível carregar estes trechos.")} />
      {chunks.isSuccess && chunks.data.chunks.length === 0 && <p className="empty-state">{t("There are no passages for this document.", "Este documento não tem trechos disponíveis.")}</p>}
      <div className="grid gap-3">
        {chunks.data?.chunks.map((chunk) => {
          const risk = chunk.security.promptInjectionRisk;
          return <article key={chunk.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between gap-4">
              <p className="font-mono text-xs text-cyan-300">{t("Passage", "Trecho")} {(chunk.ordinal + 1).toLocaleString(locale)}</p>
              <p className={`text-xs ${riskTone[risk]}`}>{t("Risk", "Risco")} · {riskLabel[risk]}</p>
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{chunk.content}</p>
          </article>;
        })}
      </div>
    </section>
  );
}
