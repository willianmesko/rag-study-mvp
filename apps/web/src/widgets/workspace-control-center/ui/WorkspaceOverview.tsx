import { useQuery } from "@tanstack/react-query";
import type { Workspace } from "../../../shared/api/rag-api";
import type { WorkspaceSection } from "../../../shared/lib/app-route";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRoleLabel } from "../model/labels";
import { documentsQuery, evaluationsQuery, ingestionJobsQuery, usageQuery } from "../model/queries";
import { WorkspaceQueryFeedback } from "./WorkspaceQueryFeedback";

function Metric({ label, value, hint, tone = "default" }: { label: string; value: string | number; hint: string; tone?: "default" | "cyan" | "emerald" | "amber" }) {
  return <article className={`workspace-metric workspace-metric--${tone}`}><p className="text-xs text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-slate-100">{value}</p><p className="mt-2 text-[11px] leading-5 text-slate-400">{hint}</p></article>;
}

export function WorkspaceOverview({ workspace, token, onNavigate }: { workspace: Workspace; token: string; onNavigate: (section: WorkspaceSection) => void }) {
  const { locale, t } = useLocale();
  const number = new Intl.NumberFormat(locale);
  const role = workspace.role;
  const documents = useQuery(documentsQuery(token, workspace.tenantId));
  const processing = useQuery(ingestionJobsQuery(token, workspace.tenantId));
  const documentCount = documents.data?.documents.length;
  const jobs = processing.data?.jobs ?? [];
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "processing").length;
  const completedJobs = jobs.filter((job) => job.status === "completed").length;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const actions = [
    ["knowledge", role === "viewer" ? t("Browse documents", "Explorar documentos") : t("Add trusted material", "Adicionar materiais confiáveis"), t("Explore the sources your team uses.", "Explore as fontes que sua equipe usa.")],
    ["processing", t("Review processing", "Acompanhar o processamento"), t("See which files Lumora is preparing for search.", "Veja quais arquivos o Lumora está preparando para a busca.")],
    ["team", t("Invite your team", "Convidar sua equipe"), t("Give each person the access they need.", "Dê a cada pessoa o acesso de que precisa.")],
    ["evaluations", t("Check answer quality", "Verificar a qualidade das respostas"), t("Run the evaluation suite before sharing the workspace.", "Execute os testes de avaliação antes de compartilhar o espaço.")]
  ] as const;
  return (
    <div className="space-y-6 animate-fade-up">
      <div className="workspace-hero panel">
        <div>
          <p className="eyebrow">{t("Workspace summary", "Resumo do espaço")}</p>
          <h3 className="mt-2 break-words text-2xl font-semibold text-white">{workspace.tenantName}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{t("Find your team’s documents, track processing, and review answer quality.", "Encontre os documentos da sua equipe, acompanhe o processamento e avalie a qualidade das respostas.")}</p>
        </div>
        <span className="status-pill status-pill--success">{workspaceRoleLabel(role, t)}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={t("Knowledge sources", "Fontes de conhecimento")} value={documentCount === undefined ? "—" : number.format(documentCount)} hint={t("Documents available for search", "Documentos disponíveis para busca")} tone="cyan" />
        <Metric label={t("Active processing", "Processamento ativo")} value={processing.data ? number.format(activeJobs) : "—"}
          hint={failedJobs ? t(`${number.format(failedJobs)} need attention`, `${number.format(failedJobs)} com falha`)
            : processing.data ? t("No processing failures", "Nenhuma falha de processamento") : t("Files being prepared", "Arquivos em preparação")}
          tone={failedJobs ? "amber" : "emerald"} />
        <Metric label={t("Completed jobs", "Processamentos concluídos")} value={processing.data ? number.format(completedJobs) : "—"} hint={t("Files processed successfully", "Arquivos processados com sucesso")} />
        {role === "owner" && <OwnerUsageMetric token={token} workspaceId={workspace.tenantId} />}
      </div>
      <WorkspaceQueryFeedback query={documents} loading={t("Loading document counts…", "Carregando contagem de documentos…")}
        failure={t("We could not load the document count.", "Não foi possível carregar a contagem de documentos.")} />
      <WorkspaceQueryFeedback query={processing} loading={t("Loading processing counts…", "Carregando contagem de processamentos…")}
        failure={t("We could not load the processing counts.", "Não foi possível carregar a contagem de processamentos.")} />
      <div className={role === "owner" ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]" : "grid gap-4"}>
        <section className="panel">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow">{t("Next steps", "Próximos passos")}</p>
              <h3 className="mt-2 text-lg font-semibold text-white">{t("What would you like to do?", "O que você gostaria de fazer?")}</h3>
            </div>
            {documentCount !== undefined && <span className="text-xs text-slate-400">{documentCount > 0 ? t("Documents ready", "Documentos prontos") : t("Start here", "Comece aqui")}</span>}
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {(role === "owner" ? actions : actions.slice(0, 2)).map(([section, title, description]) => (
              <button key={section} type="button" className="workspace-action-card" onClick={() => onNavigate(section)}>
                <span className="text-sm font-medium text-slate-100">{title}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-400">{description}</span>
                <span className="mt-3 block text-xs font-semibold text-cyan-300">{t("View details", "Ver detalhes")} →</span>
              </button>
            ))}
          </div>
        </section>
        {role === "owner" && <OwnerEvaluationSnapshot token={token} workspaceId={workspace.tenantId} onOpen={() => onNavigate("evaluations")} />}
      </div>
      <p className="text-xs leading-5 text-slate-400">{t("The similarity score measures how closely a passage matches the question. Check the source to verify the answer.", "A pontuação de similaridade mede o quanto um trecho se relaciona com a pergunta. Consulte a fonte para verificar a resposta.")}</p>
    </div>
  );
}

function OwnerUsageMetric({ token, workspaceId }: { token: string; workspaceId: string }) {
  const { locale, t } = useLocale();
  const usage = useQuery(usageQuery(token, workspaceId));
  const summary = usage.data?.summary;
  return <div className="space-y-2">
    <Metric label={t("Questions · 30 days", "Perguntas · 30 dias")} value={summary?.requests.toLocaleString(locale) ?? "—"}
      hint={summary ? t(`${Math.round(summary.averageLatencyMs).toLocaleString(locale)} ms average latency`, `Latência média de ${Math.round(summary.averageLatencyMs).toLocaleString(locale)} ms`) : t("Workspace usage", "Uso do espaço")} />
    <WorkspaceQueryFeedback query={usage} loading={t("Loading usage…", "Carregando o uso…")}
      failure={t("We could not load usage.", "Não foi possível carregar os dados de uso.")} />
  </div>;
}

function OwnerEvaluationSnapshot({ token, workspaceId, onOpen }: { token: string; workspaceId: string; onOpen: () => void }) {
  const { locale, t } = useLocale();
  const evaluations = useQuery(evaluationsQuery(token, workspaceId));
  const runs = evaluations.data?.runs;
  const latest = runs?.[0];
  const status = latest?.passed ? t("All checks passed", "Todas as verificações passaram")
    : latest ? t("Review latest run", "Revise a última avaliação") : t("Not evaluated yet", "Ainda sem avaliações");

  return <aside className="panel">
    <p className="eyebrow">{t("Quality snapshot", "Resumo de qualidade")}</p>
    <div className="mt-4 space-y-4">
      <WorkspaceQueryFeedback query={evaluations} loading={t("Loading evaluations…", "Carregando avaliações…")}
        failure={t("We could not load evaluations.", "Não foi possível carregar as avaliações.")} />
      {runs && <>
        <div><p className="text-xs text-slate-400">{t("Evaluation runs", "Avaliações realizadas")}</p><p className="mt-1 text-xl font-semibold text-slate-100">{runs.length.toLocaleString(locale)}</p></div>
        <div><p className="text-xs text-slate-400">{t("Latest status", "Último resultado")}</p><p className="mt-1 text-sm text-slate-200">{status}</p></div>
      </>}
      <button type="button" className="secondary-button w-full" onClick={onOpen}>{t("Open evaluations", "Abrir avaliações")}</button>
    </div>
  </aside>;
}
