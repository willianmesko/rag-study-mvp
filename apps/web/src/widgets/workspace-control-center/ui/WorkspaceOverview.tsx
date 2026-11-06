import type { EvaluationRun, ManagedDocument, UploadJob, UsageSummary, Workspace } from "../../../shared/api/rag-api";
import type { WorkspaceSection } from "../../../shared/lib/app-route";
import { useLocale } from "../../../shared/i18n/locale";

function Metric({ label, value, hint, tone = "default" }: { label: string; value: string | number; hint: string; tone?: "default" | "cyan" | "emerald" | "amber" }) {
  return <article className={`workspace-metric workspace-metric--${tone}`}><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-slate-100">{value}</p><p className="mt-2 text-[11px] leading-5 text-slate-500">{hint}</p></article>;
}

export function WorkspaceOverview({ workspace, documents, jobs, usage, evaluations, onNavigate }: { workspace?: Workspace; documents: ManagedDocument[]; jobs: UploadJob[]; usage?: UsageSummary; evaluations: EvaluationRun[]; onNavigate: (section: WorkspaceSection) => void }) {
  const { locale, t } = useLocale();
  const number = new Intl.NumberFormat(locale);
  const role = workspace?.role;
  const roleLabel = role === "owner" ? t("Owner", "Proprietário")
    : role === "editor" ? t("Editor", "Editor")
    : role === "viewer" ? t("Viewer", "Leitor")
    : t("Member", "Membro");
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "processing").length;
  const completedJobs = jobs.filter((job) => job.status === "completed").length;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const actions = [
    ["knowledge", role === "viewer" ? t("Browse documents", "Explorar documentos") : t("Add trusted material", "Adicionar materiais confiáveis"), t("Explore the sources your team uses.", "Explore as fontes que sua equipe usa.")],
    ["processing", t("Review processing", "Acompanhar o processamento"), t("See which files Lumora is preparing for search.", "Veja quais arquivos o Lumora está preparando para a busca.")],
    ["team", t("Invite your team", "Convidar sua equipe"), t("Give each person the access they need.", "Dê a cada pessoa o acesso de que precisa.")],
    ["evaluations", t("Check answer quality", "Verificar a qualidade das respostas"), t("Run the evaluation suite before sharing the workspace.", "Execute os testes de avaliação antes de compartilhar o espaço.")]
  ] as const;
  const status = evaluations[0]?.passed ? t("All checks passed", "Todas as verificações passaram")
    : evaluations.length ? t("Review latest run", "Revise a última avaliação")
    : t("Not evaluated yet", "Ainda sem avaliações");

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="workspace-hero panel">
        <div>
          <p className="eyebrow">{t("Workspace summary", "Resumo do espaço")}</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">{workspace?.tenantName ?? t("Your knowledge workspace", "Seu espaço de conhecimento")}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{t("Find your team’s documents, track processing, and review answer quality.", "Encontre os documentos da sua equipe, acompanhe o processamento e avalie a qualidade das respostas.")}</p>
        </div>
        <span className="status-pill status-pill--success">{roleLabel}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={t("Knowledge sources", "Fontes de conhecimento")} value={number.format(documents.length)} hint={t("Documents available for search", "Documentos disponíveis para busca")} tone="cyan" />
        <Metric label={t("Active processing", "Processamento ativo")} value={number.format(activeJobs)}
          hint={failedJobs ? t(`${number.format(failedJobs)} need attention`, `${number.format(failedJobs)} com falha`) : t("No processing failures", "Nenhuma falha de processamento")}
          tone={failedJobs ? "amber" : "emerald"} />
        <Metric label={t("Completed jobs", "Processamentos concluídos")} value={number.format(completedJobs)} hint={t("Files processed successfully", "Arquivos processados com sucesso")} />
        {role === "owner" && <Metric label={t("Questions · 30 days", "Perguntas · 30 dias")} value={usage ? number.format(usage.requests) : "—"}
          hint={usage ? t(`${number.format(Math.round(usage.averageLatencyMs))} ms average latency`, `Latência média de ${number.format(Math.round(usage.averageLatencyMs))} ms`) : t("Workspace usage", "Uso do espaço")} />}
      </div>
      <div className={role === "owner" ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]" : "grid gap-4"}>
        <section className="panel">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow">{t("Next steps", "Próximos passos")}</p>
              <h3 className="mt-2 text-lg font-semibold text-white">{t("What would you like to do?", "O que você gostaria de fazer?")}</h3>
            </div>
            <span className="text-xs text-slate-500">{documents.length > 0 ? t("Documents ready", "Documentos prontos") : t("Start here", "Comece aqui")}</span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {(role === "owner" ? actions : actions.slice(0, 2)).map(([section, title, description]) => (
              <button key={section} type="button" className="workspace-action-card" onClick={() => onNavigate(section)}>
                <span className="text-sm font-medium text-slate-100">{title}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
                <span className="mt-3 block text-xs font-semibold text-cyan-300">{t("View details", "Ver detalhes")} →</span>
              </button>
            ))}
          </div>
        </section>
        {role === "owner" && (
          <aside className="panel">
            <p className="eyebrow">{t("Quality snapshot", "Resumo de qualidade")}</p>
            <div className="mt-4 space-y-4">
              <div><p className="text-xs text-slate-500">{t("Evaluation runs", "Avaliações realizadas")}</p><p className="mt-1 text-xl font-semibold text-slate-100">{number.format(evaluations.length)}</p></div>
              <div><p className="text-xs text-slate-500">{t("Latest status", "Último resultado")}</p><p className="mt-1 text-sm text-slate-200">{status}</p></div>
              <button type="button" className="secondary-button w-full" onClick={() => onNavigate("evaluations")}>{t("Open evaluations", "Abrir avaliações")}</button>
            </div>
          </aside>
        )}
      </div>
      <p className="text-xs leading-5 text-slate-500">{t("The similarity score measures how closely a passage matches the question. Check the source to verify the answer.", "A pontuação de similaridade mede o quanto um trecho se relaciona com a pergunta. Consulte a fonte para verificar a resposta.")}</p>
    </div>
  );
}
