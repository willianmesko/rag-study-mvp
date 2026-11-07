import { lazy, Suspense } from "react";
import type { Workspace } from "../../../shared/api/rag-api";
import { canAccessWorkspaceSection, type WorkspaceSection } from "../../../shared/lib/app-route";
import { useLocale } from "../../../shared/i18n/locale";
import { WorkspaceOverview } from "./WorkspaceOverview";
import { WorkspaceSectionNav } from "./WorkspaceSectionNav";

const WorkspaceKnowledge = lazy(() => import("./WorkspaceKnowledge").then(({ WorkspaceKnowledge }) => ({ default: WorkspaceKnowledge })));
const WorkspaceProcessing = lazy(() => import("./WorkspaceProcessing").then(({ WorkspaceProcessing }) => ({ default: WorkspaceProcessing })));
const WorkspaceTeam = lazy(() => import("./WorkspaceTeam").then(({ WorkspaceTeam }) => ({ default: WorkspaceTeam })));
const WorkspaceEvaluations = lazy(() => import("./WorkspaceEvaluations").then(({ WorkspaceEvaluations }) => ({ default: WorkspaceEvaluations })));
const WorkspaceSettings = lazy(() => import("./WorkspaceSettings").then(({ WorkspaceSettings }) => ({ default: WorkspaceSettings })));

type WorkspaceControlCenterProps = {
  section: WorkspaceSection;
  workspace: Workspace;
  token: string;
  onSectionChange: (section: WorkspaceSection) => void;
};

export function WorkspaceControlCenter({ section, workspace, token, onSectionChange }: WorkspaceControlCenterProps) {
  const { t } = useLocale();
  const sectionCopy = {
    overview: [t("A clear view of this workspace", "Seu espaço em um só lugar"), t("See what is ready, what is processing, and what to do next.", "Veja o que está pronto, o que está em processamento e o que fazer a seguir.")],
    knowledge: [t("Keep trusted knowledge current", "Mantenha os documentos atualizados"), t("Upload sources, explore passages, and refresh the index when a file changes.", "Envie fontes, explore os trechos e atualize o índice quando um arquivo mudar.")],
    processing: [t("Follow every processing step", "Acompanhe cada etapa do processamento"), t("See how a file goes from upload to searchable knowledge.", "Veja como um arquivo fica disponível para busca depois do envio.")],
    team: [t("Give people the right access", "Gerencie o acesso da equipe"), t("Invite teammates and decide what each person can do.", "Convide colegas e defina o que cada pessoa pode fazer.")],
    evaluations: [t("Review answer quality", "Acompanhe a qualidade das respostas"), t("Run reference tests and review search quality and safety.", "Execute os testes de referência e confira a qualidade e a segurança da busca.")],
    settings: [t("Workspace settings", "Configurações do espaço"), t("Review the workspace profile and usage limits.", "Confira o perfil do espaço e os limites de uso.")]
  };
  const [heading, description] = sectionCopy[section];

  return (
    <section className="space-y-6">
      <div className="workspace-control-center__heading">
        <div>
          <p className="eyebrow">{t("Workspace control center", "Central do espaço de trabalho")}</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            {t("Put your team’s knowledge to work", "Coloque o conhecimento da sua equipe em prática")}
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            {t("Organize sources, follow document processing, manage access, and review answer quality.", "Organize as fontes, acompanhe o processamento de documentos, gerencie o acesso e avalie a qualidade das respostas.")}
          </p>
        </div>
        <span className="status-pill">{t("Workspace", "Espaço de trabalho")}</span>
      </div>
      <WorkspaceSectionNav activeSection={section} role={workspace.role} onChange={onSectionChange} />
      <section className="space-y-8">
        <div className="border-b border-slate-800/80 pb-6">
          <p className="eyebrow">{t("Workspace", "Espaço de trabalho")}</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{heading}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>
        </div>
        {workspace.role === "viewer" && <p className="rounded-xl border border-violet-400/30 bg-violet-400/10 p-3 text-sm text-violet-100">{t("Your access is read-only. You can browse documents and track processing.", "Seu acesso é somente leitura. Você pode explorar documentos e acompanhar o processamento.")}</p>}
        <Suspense key={`${workspace.tenantId}:${workspace.role}:${section}`} fallback={<p role="status" className="empty-state">{t("Opening section…", "Abrindo a seção…")}</p>}>
          <WorkspaceSectionContent section={section} workspace={workspace} token={token} onSectionChange={onSectionChange} />
        </Suspense>
      </section>
    </section>
  );
}

function WorkspaceSectionContent({ section, workspace, token, onSectionChange }: WorkspaceControlCenterProps) {
  const { t } = useLocale();
  if (!canAccessWorkspaceSection(section, workspace.role)) {
    const messages = {
      team: t("Only workspace owners can manage members and invitations.", "Somente proprietários podem gerenciar membros e convites."),
      evaluations: t("Evaluations are available to workspace owners.", "As avaliações estão disponíveis para proprietários."),
      settings: t("Workspace settings are available to owners.", "As configurações do espaço estão disponíveis para proprietários.")
    };
    const message = section === "team" || section === "evaluations" || section === "settings" ? messages[section] : null;
    return <p className="empty-state">{message}</p>;
  }
  switch (section) {
    case "overview": return <WorkspaceOverview workspace={workspace} token={token} onNavigate={onSectionChange} />;
    case "knowledge": return <WorkspaceKnowledge workspace={workspace} token={token} />;
    case "processing": return <WorkspaceProcessing workspace={workspace} token={token} />;
    case "team": return <WorkspaceTeam workspaceId={workspace.tenantId} token={token} />;
    case "evaluations": return <WorkspaceEvaluations workspaceId={workspace.tenantId} token={token} />;
    case "settings": return <WorkspaceSettings workspace={workspace} token={token} />;
  }
}
