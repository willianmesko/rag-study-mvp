import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type UploadJob, type Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRequestError } from "../../../shared/lib/request-error";
import { SelectField } from "../../../shared/ui/SelectField";
import { ingestionJobsQuery } from "../model/queries";
import { IngestionPassagePreview } from "./IngestionPassagePreview";
import { PipelineVisualization, statusLabel } from "./PipelineVisualization";
import { WorkspaceQueryFeedback } from "./WorkspaceQueryFeedback";

const jobStatuses = ["queued", "processing", "completed", "failed"] as const;

export function WorkspaceProcessing({ workspace, token }: { workspace: Workspace; token: string }) {
  const { locale, t } = useLocale();
  const number = new Intl.NumberFormat(locale);
  const workspaceId = workspace.tenantId;
  const canManage = workspace.role !== "viewer";
  const queryClient = useQueryClient();
  const jobOptions = ingestionJobsQuery(token, workspaceId);
  const jobs = useQuery(jobOptions);
  const [jobFilter, setJobFilter] = useState<"all" | UploadJob["status"]>("all");
  const activeJob = jobs.data?.jobs.find(({ status }) => status === "processing" || status === "queued") ?? jobs.data?.jobs[0];
  const filteredJobs = (jobs.data?.jobs ?? []).filter(({ status }) => jobFilter === "all" || status === jobFilter);
  const retry = useMutation({
    mutationFn: (jobId: string) => api.retryUpload(jobId, token, workspaceId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: jobOptions.queryKey }); }
  });

  return (
    <div className="space-y-6">
      {activeJob && <ProcessingTimeline job={activeJob} token={token} workspaceId={workspaceId} />}
      <section className="panel space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">{t("Processing center", "Central de processamento")}</p>
            <h3 className="mt-2 text-lg font-semibold text-white">{t("Recently processed files", "Arquivos processados recentemente")}</h3>
            <p className="mt-2 text-sm text-slate-400">{t("Follow each file from upload to search.", "Acompanhe cada arquivo do envio à busca.")}</p>
          </div>
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
        {jobs.isSuccess && filteredJobs.length === 0 && <p className="empty-state">{t("No processing jobs match this filter.", "Nenhum processamento corresponde a esse filtro.")}</p>}
        {retry.isSuccess && <p className="success-message" role="status">{t("File queued for another attempt.", "Arquivo na fila para uma nova tentativa.")}</p>}
        {retry.isError && <p className="error-message" role="alert">{workspaceRequestError(retry.error, t, t("We could not retry this file.", "Não foi possível reprocessar este arquivo."))}</p>}
        {filteredJobs.map((job) => (
          <article className="animate-fade-up rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-sm" key={job.id}>
            <div className="flex justify-between gap-4">
              <span className="truncate text-slate-100">{job.title ?? job.filename}</span>
              <span className="shrink-0 font-mono text-xs text-cyan-300">{statusLabel(job.status, t)} · {number.format(job.progress)}%</span>
            </div>
            <p className="mt-1 break-words text-xs text-slate-500">{job.source}{job.chunkCount !== null && " · " + number.format(job.chunkCount) + " " + (job.chunkCount === 1 ? t("passage", "trecho") : t("passages", "trechos"))}</p>
            {canManage && job.status === "completed" && <IngestionPassagePreview key={job.updatedAt} jobId={job.id}
              documentName={job.title ?? job.filename} accessToken={token} workspaceId={workspaceId} />}
            {job.error && <p className="mt-2 text-xs text-rose-300">{t("Processing failed.", "Falha no processamento.")}</p>}
            {canManage && job.status === "failed" && <button type="button" className="mt-3 text-xs font-medium text-cyan-300 hover:text-cyan-100"
              onClick={() => retry.mutate(job.id)} disabled={retry.isPending}>
              {retry.isPending && retry.variables === job.id ? t("Queueing again…", "Colocando na fila…") : t("Try again", "Tentar novamente")}
            </button>}
          </article>
        ))}
      </section>
    </div>
  );
}

function ProcessingTimeline({ job, token, workspaceId }: { job: UploadJob; token: string; workspaceId: string }) {
  const { t } = useLocale();
  const events = useQuery({
    queryKey: ["ingestion-events", token, workspaceId, job.id, job.status],
    queryFn: () => api.listUploadEvents(job.id, token, workspaceId),
    refetchInterval: job.status === "processing" || job.status === "queued" ? 1_500 : false
  });
  return <>
    <PipelineVisualization job={job} events={events.data?.events ?? []} />
    <WorkspaceQueryFeedback query={events} loading={t("Loading processing timeline…", "Carregando a linha do tempo…")}
      failure={t("We could not load the processing timeline.", "Não foi possível carregar a linha do tempo do processamento.")} />
  </>;
}
