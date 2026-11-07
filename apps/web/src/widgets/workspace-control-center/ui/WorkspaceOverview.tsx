import { useQuery } from "@tanstack/react-query";
import type { Workspace } from "../../../shared/api/rag-api";
import type { WorkspaceSection } from "../../../shared/lib/app-route";
import { useLocale } from "../../../shared/i18n/locale";
import { documentsQuery, ingestionJobsQuery, usageQuery } from "../model/queries";
import { statusLabel } from "./PipelineVisualization";
import { WorkspacePageHeader } from "./WorkspacePageHeader";
import { WorkspaceQueryFeedback } from "./WorkspaceQueryFeedback";

export function WorkspaceOverview({ workspace, token, onNavigate }: { workspace: Workspace; token: string; onNavigate: (section: WorkspaceSection) => void }) {
  const { locale, t } = useLocale();
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const documents = useQuery(documentsQuery(token, workspace.tenantId));
  const processing = useQuery(ingestionJobsQuery(token, workspace.tenantId));
  const jobs = processing.data?.jobs ?? [];
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "processing").length;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const activity = (jobs.length ? jobs.map((job) => ({
    id: job.id, title: job.title ?? job.filename, updatedAt: job.updatedAt,
    status: statusLabel(job.status, t), section: "processing" as const
  })) : (documents.data?.documents ?? []).map((document) => ({
    id: document.id, title: document.title ?? document.source, updatedAt: document.updatedAt,
    status: t("Ready to search", "Disponível para busca"), section: "knowledge" as const
  }))).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).slice(0, 5);
  const metrics = [
    [t("Documents", "Documentos"), documents.data ? number.format(documents.data.documents.length) : "—"],
    [t("Processing", "Em processamento"), processing.data ? number.format(activeJobs) : "—"],
    [t("Needs attention", "Requer atenção"), processing.data ? number.format(failedJobs) : "—"]
  ];

  return <div className="space-y-6">
    <WorkspacePageHeader title={t("Overview", "Visão geral")}>
      <button className="primary-button" type="button" onClick={() => onNavigate("knowledge")}>{t("View documents", "Ver documentos")}</button>
    </WorkspacePageHeader>
    <dl className="grid grid-cols-3 divide-x divide-slate-800 border-y border-slate-800 py-5">
      {metrics.map(([label, value]) => <div className="min-w-0 px-3 first:pl-0 sm:px-6" key={label}>
        <dt className="text-xs leading-5 text-slate-400">{label}</dt>
        <dd className="mt-1 text-2xl font-semibold tracking-tight text-slate-100">{value}</dd>
      </div>)}
    </dl>
    <WorkspaceQueryFeedback query={documents} loading={t("Loading documents…", "Carregando documentos…")}
      failure={t("We could not load documents.", "Não foi possível carregar os documentos.")} />
    <WorkspaceQueryFeedback query={processing} loading={t("Loading processing status…", "Carregando o status dos arquivos…")}
      failure={t("We could not load processing status.", "Não foi possível carregar o status dos arquivos.")} />
    {failedJobs > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-4">
      <p className="text-sm text-amber-100">{failedJobs === 1
        ? t("One file needs another processing attempt.", "Um arquivo precisa de uma nova tentativa de processamento.")
        : t(`${number.format(failedJobs)} files need another processing attempt.`, `${number.format(failedJobs)} arquivos precisam de uma nova tentativa de processamento.`)}</p>
      <button className="secondary-button" type="button" onClick={() => onNavigate("processing")}>{t("Review files", "Revisar arquivos")}</button>
    </div>}
    {workspace.role === "owner" && <OwnerBudgetNotice workspaceId={workspace.tenantId} token={token} onOpen={() => onNavigate("settings")} />}
    <section aria-labelledby="workspace-recent-activity" className="space-y-3">
      <h2 id="workspace-recent-activity" className="text-base font-semibold text-slate-100">{t("Recent activity", "Atividades recentes")}</h2>
      {activity.length > 0 && <ul className="divide-y divide-slate-800 border-y border-slate-800">
        {activity.map((item) => <li key={item.id}>
          <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg py-4 text-left hover:bg-slate-800/40" onClick={() => onNavigate(item.section)}>
            <span className="min-w-0 flex-1 basis-48">
              <span className="block truncate text-sm font-medium text-slate-100">{item.title}</span>
              <span className="mt-1 block text-xs text-slate-400">{item.status}</span>
            </span>
            <time className="text-xs text-slate-400" dateTime={item.updatedAt}>{date.format(new Date(item.updatedAt))}</time>
          </button>
        </li>)}
      </ul>}
      {processing.isSuccess && documents.isSuccess && activity.length === 0 && <p className="empty-state">
        {workspace.role === "viewer"
          ? t("Your team’s documents and processing updates will appear here.", "Os documentos e as atualizações de processamento da equipe aparecerão aqui.")
          : t("Add your first document from Documents to start building your workspace.", "Adicione o primeiro arquivo em Documentos para começar a preparar seu espaço.")}
      </p>}
    </section>
  </div>;
}

function OwnerBudgetNotice({ workspaceId, token, onOpen }: { workspaceId: string; token: string; onOpen: () => void }) {
  const { locale, t } = useLocale();
  const usage = useQuery(usageQuery(token, workspaceId));
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" });
  return <>
    <WorkspaceQueryFeedback query={usage} loading={t("Checking usage…", "Consultando o uso…")}
      failure={t("We could not check the budget alert.", "Não foi possível consultar o alerta de orçamento.")} />
    {usage.data?.alert.triggered && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-4">
      <p className="text-sm text-amber-100">{t("Estimated usage reached the budget alert of", "O uso estimado atingiu o alerta de orçamento de")} {currency.format(usage.data.alert.thresholdUsd)}.</p>
      <button type="button" className="secondary-button" onClick={onOpen}>{t("Review usage", "Ver uso")}</button>
    </div>}
  </>;
}
