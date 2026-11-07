import { useQueryIdentity } from "../../../shared/lib/query-identity";
import { privateQueryKey } from "../../../shared/lib/query-keys";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type UploadJob, type Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";
import { SelectField } from "../../../shared/ui/SelectField";
import { ActionMenu } from "../../../shared/ui/ActionMenu";
import { Overlay } from "../../../shared/ui/Overlay";
import { ingestionJobsQuery } from "../model/queries";
import { IngestionPassagePreview } from "./IngestionPassagePreview";
import { PipelineVisualization, statusLabel } from "./PipelineVisualization";
import { WorkspaceQueryFeedback } from "./WorkspaceQueryFeedback";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

const jobStatuses = ["queued", "processing", "completed", "failed"] as const;

export function WorkspaceProcessing({ workspace, token }: { workspace: Workspace; token: string }) {
  const userId = useQueryIdentity();
  const { locale, t } = useLocale();
  const number = new Intl.NumberFormat(locale);
  const workspaceId = workspace.tenantId;
  const canManage = workspace.role !== "viewer";
  const queryClient = useQueryClient();
  const jobOptions = ingestionJobsQuery(token, workspaceId, userId);
  const jobs = useQuery(jobOptions);
  const [jobFilter, setJobFilter] = useState<"all" | UploadJob["status"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedJob = jobs.data?.jobs.find((job) => job.id === selectedId);
  const filteredJobs = (jobs.data?.jobs ?? []).filter(({ status }) => jobFilter === "all" || status === jobFilter);
  const retry = useMutation({
    mutationFn: (jobId: string) => api.retryUpload(jobId, token, workspaceId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: jobOptions.queryKey }); }
  });

  const cancel = useMutation({
    mutationFn:(jobId:string)=>api.cancelUpload(jobId,token,workspaceId),
    onSuccess:()=>{void queryClient.invalidateQueries({queryKey:jobOptions.queryKey});}
  });
  return (
    <div className="space-y-6">
      <WorkspacePageHeader title={t("Processing", "Processamento")} description={t("Follow files as they become available for search.", "Acompanhe os arquivos até ficarem disponíveis para busca.")}>
        <button type="button" className="secondary-button" disabled={jobs.isFetching} aria-busy={jobs.isFetching} onClick={() => void jobs.refetch()}>{t("Refresh", "Atualizar")}</button>
      </WorkspacePageHeader>
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SelectField label={t("Processing status", "Status do processamento")} className="w-full sm:w-52" value={jobFilter}
            options={[
              { value: "all", label: t("All statuses", "Todos os status") },
              ...jobStatuses.map((status) => ({ value: status, label: statusLabel(status, t) }))
            ]}
            onValueChange={(value) => {
              const status = jobStatuses.find((item) => item === value);
              if (value === "all" || status) setJobFilter(status ?? "all");
            }} />
        </div>
        <WorkspaceQueryFeedback query={jobs} loading={t("Loading files…", "Carregando arquivos…")}
          failure={t("We could not load processing jobs.", "Não foi possível carregar os processamentos.")} />
        {jobs.isSuccess && filteredJobs.length === 0 && <p className="empty-state">{jobFilter === "all"
          ? t("Files and pages you add will appear here while Lumora prepares them for search.", "Os arquivos e páginas que você adicionar aparecerão aqui enquanto o Lumora os prepara para busca.")
          : t("No files match this filter. Choose another status to see more files.", "Nenhum arquivo corresponde a esse filtro. Escolha outro status para ver mais arquivos.")}</p>}
        {retry.isSuccess && <p className="success-message" role="status">{t("File queued for another attempt.", "Arquivo na fila para uma nova tentativa.")}</p>}
        {retry.isError && <p className="error-message" role="alert">{workspaceRequestError(retry.error, t, t("We could not retry this file.", "Não foi possível reprocessar este arquivo."))}</p>}
        {cancel.isSuccess && <p className="success-message" role="status">{t("Processing stopped. You can retry this file later.","Processamento interrompido. Você pode tentar novamente depois.")}</p>}
        {cancel.isError && <p className="error-message" role="alert">{workspaceRequestError(cancel.error,t,t("Could not stop processing.","Não foi possível interromper o processamento."))}</p>}
        <ul className="divide-y divide-slate-800 border-y border-slate-800">
          {filteredJobs.map((job) => <li className="flex min-w-0 items-center gap-3 py-4" key={job.id}>
            <button className="min-w-0 flex-1 rounded-lg text-left hover:bg-slate-800/40" type="button" aria-haspopup="dialog" onClick={() => setSelectedId(job.id)}>
              <span className="block truncate text-sm font-medium text-slate-100">{job.title ?? job.filename}</span>{" "}
              <span className="mt-1 block text-xs text-slate-400">{job.chunkCount !== null ? `${number.format(job.chunkCount)} ${t("passages", "trechos")}` : job.filename}</span>
            </button>
            <span className={`shrink-0 text-xs ${job.status === "failed" ? "text-rose-200" : "text-slate-400"}`}>{statusLabel(job.status, t)} · {number.format(job.progress)}%</span>
            <ActionMenu label={t(`Actions for ${job.title ?? job.filename}`, `Ações para ${job.title ?? job.filename}`)} actions={[
              { label: t("View timeline", "Ver etapas"), onSelect: () => setSelectedId(job.id) },
              ...(canManage && ["queued","processing"].includes(job.status) ? [{label:t("Stop processing","Interromper processamento"),onSelect:()=>cancel.mutate(job.id),disabled:cancel.isPending}] : []),
              ...(canManage && job.status === "failed" ? [{ label: t("Try again", "Tentar novamente"), onSelect: () => retry.mutate(job.id), disabled: retry.isPending }] : [])
            ]} />
          </li>)}
        </ul>
      </section>
      {selectedJob && <Overlay side title={selectedJob.title ?? selectedJob.filename}
        description={`${statusLabel(selectedJob.status, t)} · ${number.format(selectedJob.progress)}%`} onClose={() => setSelectedId(null)}>
        <ProcessingTimeline job={selectedJob} token={token} workspaceId={workspaceId} />
        {canManage && selectedJob.status === "completed" && <IngestionPassagePreview key={selectedJob.updatedAt} jobId={selectedJob.id}
          documentName={selectedJob.title ?? selectedJob.filename} accessToken={token} workspaceId={workspaceId} />}
        {canManage && selectedJob.status === "failed" && <button className="primary-button" type="button" disabled={retry.isPending} onClick={() => retry.mutate(selectedJob.id)}>{t("Try again", "Tentar novamente")}</button>}
        {retry.isError && <p className="error-message" role="alert">{workspaceRequestError(retry.error, t, t("We could not retry this file.", "Não foi possível reprocessar este arquivo."))}</p>}
      </Overlay>}
    </div>
  );
}

function ProcessingTimeline({ job, token, workspaceId }: { job: UploadJob; token: string; workspaceId: string }) {
  const userId = useQueryIdentity();
  const { t } = useLocale();
  const events = useQuery({
    queryKey: privateQueryKey("ingestion-events", userId, workspaceId, job.id, job.status),
    queryFn: ({ signal }) => api.listUploadEvents(job.id, token, workspaceId, signal),
    retry: false,
    refetchInterval: (query) => query.state.status !== "error" && (job.status === "processing" || job.status === "queued") ? 1_500 : false
  });
  return <>
    <PipelineVisualization job={job} events={events.data?.events ?? []} />
    <WorkspaceQueryFeedback query={events} loading={t("Loading processing timeline…", "Carregando a linha do tempo…")}
      failure={t("We could not load the processing timeline.", "Não foi possível carregar a linha do tempo do processamento.")} />
  </>;
}
