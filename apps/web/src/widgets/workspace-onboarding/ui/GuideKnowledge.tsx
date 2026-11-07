import { useQueryIdentity } from "../../../shared/lib/query-identity";
import { privateQueryKey } from "../../../shared/lib/query-keys";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getStarterTemplate,
  type StarterGoal,
} from "../../../entities/starter-template/index";
import {
  guideDocumentsQuery,
  guideJobsQuery,
} from "../../../features/workspace-onboarding/index";
import {
  api,
  type UploadJob,
  type Workspace,
} from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";

export function GuideKnowledge({
  workspace,
  token,
  goal,
  onPendingChange,
  onReadyChange,
}: {
  workspace: Workspace;
  token: string;
  goal: StarterGoal;
  onPendingChange: (pending: boolean) => void;
  onReadyChange: (ready: boolean) => void;
}) {
  const userId = useQueryIdentity();
  const { locale, t } = useLocale();
  const template = getStarterTemplate(goal, locale);
  const client = useQueryClient();
  const documentOptions = guideDocumentsQuery(token, workspace.tenantId, userId);
  const jobOptions = guideJobsQuery(token, workspace.tenantId, userId);
  const documents = useQuery(documentOptions),
    jobs = useQuery(jobOptions);
  const [file, setFile] = useState<File | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const canUpload = workspace.role !== "viewer";
  const templateSource = `onboarding/templates/${template.filename}`;
  const upload = useMutation({
    mutationFn: ({ document, source }: { document: File; source: string }) =>
      api.uploadDocument({
        file: document,
        source,
        accessToken: token,
        workspaceId: workspace.tenantId,
        signal: AbortSignal.timeout(60_000),
      }),
    onSuccess: ({ job }) => {
      setSelectedJobId(job.id);
      client.setQueryData<{ jobs: UploadJob[] }>(
        jobOptions.queryKey,
        (current) => ({
          jobs: [
            job,
            ...(current?.jobs ?? []).filter(({ id }) => id !== job.id),
          ],
        }),
      );
      void client.invalidateQueries({
        queryKey: documentOptions.queryKey,
        exact: true,
      });
      void client.invalidateQueries({
        queryKey: privateQueryKey("documents", userId, workspace.tenantId),
        exact: true,
      });
      void client.invalidateQueries({
        queryKey: privateQueryKey("ingestion-jobs", userId, workspace.tenantId),
        exact: true,
      });
      setFile(null);
    },
  });
  const activeJob =
    jobs.data?.jobs.find(({ id }) => id === selectedJobId) ??
    (upload.data?.job.id === selectedJobId ? upload.data.job : undefined) ??
    jobs.data?.jobs.find(
      ({ status }) => status === "queued" || status === "processing",
    );
  const preparing =
    upload.isPending ||
    activeJob?.status === "queued" ||
    activeJob?.status === "processing";
  const available = documents.data?.documents ?? [];
  const readyDocument = available.find(
    (document) =>
      document.chunkCount > 0 &&
      (!selectedJobId || document.source === activeJob?.source),
  );
  const ready = Boolean(readyDocument) && !preparing;
  const sampleExists =
    available.some(({ source }) => source === templateSource) ||
    jobs.data?.jobs.some(
      ({ source, status }) =>
        source === templateSource &&
        (status === "queued" || status === "processing"),
    );

  useEffect(() => {
    onPendingChange(upload.isPending);
    return () => onPendingChange(false);
  }, [upload.isPending, onPendingChange]);
  useEffect(() => {
    onReadyChange(ready);
  }, [ready, onReadyChange]);
  useEffect(() => {
    if (activeJob?.status === "completed")
      void client.invalidateQueries({
        queryKey: documentOptions.queryKey,
        exact: true,
      });
  }, [activeJob?.id, activeJob?.status, client, token, workspace.tenantId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canUpload && file && !upload.isPending)
      upload.mutate({
        document: file,
        source: `onboarding/${encodeURIComponent(file.name).slice(0, 750)}`,
      });
  }

  return (
    <div
      className="workspace-guide__detail"
      role="region"
      aria-label={t("Document setup", "Configuração de documentos")}
      aria-busy={documents.isPending || jobs.isPending}
    >
      {documents.isPending ? (
        <p role="status">
          {t("Checking your documents…", "Conferindo seus documentos…")}
        </p>
      ) : preparing ? (
        <section
          className="workspace-guide__preparation"
          aria-label={t("Document preparation", "Preparação do documento")}
        >
          <span className="workspace-guide__file-icon" aria-hidden="true">
            ▤
          </span>
          <h3>{activeJob?.filename ?? file?.name ?? template.filename}</h3>
          <p role="status">
            {upload.isPending
              ? t(
                  "Sending your file securely…",
                  "Enviando seu arquivo com segurança…",
                )
              : activeJob?.status === "queued"
                ? t(
                    "File received. Milo will prepare it next…",
                    "Arquivo recebido. O Milo vai prepará-lo em seguida…",
                  )
                : t(
                    "Milo is preparing your document for questions…",
                    "O Milo está preparando seu documento para perguntas…",
                  )}
          </p>
          <progress
            max={100}
            value={Math.max(0, Math.min(100, activeJob?.progress ?? 0))}
            aria-label={t(
              "Document preparation progress",
              "Progresso de preparação do documento",
            )}
          />
        </section>
      ) : ready ? (
        <div className="workspace-guide__confirmation" role="status">
          <span className="workspace-guide__check" aria-hidden="true">
            ✓
          </span>
          <p>
            {t(
              "Your document is ready. Shall we ask the first question?",
              "Seu documento está pronto. Vamos fazer a primeira pergunta?",
            )}
          </p>
          <span className="text-sm text-slate-400 break-words">
            {readyDocument!.title ?? readyDocument!.source}
          </span>
        </div>
      ) : canUpload ? (
        <>
          <form className="workspace-guide__upload" onSubmit={submit}>
            <label className="grid min-w-0 gap-3 text-sm font-medium text-slate-100">
              <span className="workspace-guide__file-icon" aria-hidden="true">
                ↑
              </span>
              {t(
                "Choose your first document",
                "Escolha seu primeiro documento",
              )}
              <input
                ref={fileInput}
                className="field min-w-0"
                type="file"
                accept=".pdf,.docx,.txt,.md,.markdown"
                aria-describedby={hintId}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  upload.reset();
                }}
              />
            </label>
            <p id={hintId}>
              {t(
                "PDF, Word, text or Markdown.",
                "PDF, Word, texto ou Markdown.",
              )}
            </p>
            <button
              className="primary-button w-fit"
              type="submit"
              disabled={!file}
            >
              {t("Upload document", "Enviar documento")}
            </button>
          </form>
          <p className="text-xs">
            {t(
              "Workspace members can consult this file. Share only approved material; relevant passages may be sent to your AI provider.",
              "Os membros do espaço poderão consultar este arquivo. Envie apenas materiais autorizados; trechos relevantes podem ser enviados ao provedor de IA.",
            )}
          </p>
          <details className="workspace-guide__optional w-full">
            <summary>
              {t("I'd rather try a sample", "Prefiro usar um exemplo")}
            </summary>
            <div className="mt-3 space-y-3">
              <p>
                {template.title}.{" "}
                {t(
                  "Fictional content for practice. Adding it counts as a document upload.",
                  "Conteúdo fictício para praticar. Adicioná-lo conta como um envio de documento.",
                )}
              </p>
              <button
                className="secondary-button"
                type="button"
                disabled={sampleExists}
                onClick={() =>
                  upload.mutate({
                    document: new File([template.content], template.filename, {
                      type: "text/markdown",
                    }),
                    source: templateSource,
                  })
                }
              >
                {t("Use sample document", "Usar documento de exemplo")}
              </button>
              <details>
                <summary>{t("Preview sample", "Ver o exemplo")}</summary>
                <pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-6 text-slate-300 [overflow-wrap:anywhere]">
                  {template.content}
                </pre>
              </details>
            </div>
          </details>
        </>
      ) : (
        <p>
          {t(
            "An owner or editor can add the first document. You can continue later and return when it is ready.",
            "Um proprietário ou editor pode adicionar o primeiro documento. Você pode continuar depois e voltar quando estiver pronto.",
          )}
        </p>
      )}
      {upload.isError && (
        <p className="error-message" role="alert">
          {getRequestErrorMessage(upload.error, locale)}
        </p>
      )}
      {activeJob?.status === "failed" && !ready && (
        <p className="error-message" role="alert">
          {t(
            "Milo could not prepare this file. Try another document, or retry it in Processing later.",
            "O Milo não conseguiu preparar este arquivo. Tente outro documento ou repita o processamento depois.",
          )}
        </p>
      )}
      {(documents.isError || jobs.isError) && (
        <div className="space-y-2">
          <p className="error-message" role="alert">
            {t(
              "We couldn't check preparation. Your file may still be processing.",
              "Não conseguimos conferir a preparação. Seu arquivo pode continuar sendo processado.",
            )}
          </p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              void documents.refetch();
              void jobs.refetch();
            }}
          >
            {t("Refresh documents", "Atualizar documentos")}
          </button>
        </div>
      )}
    </div>
  );
}
