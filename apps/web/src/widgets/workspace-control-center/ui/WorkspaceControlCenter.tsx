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
const WorkspaceUsagePage = lazy(() => import("./WorkspaceUsagePage").then(({ WorkspaceUsagePage }) => ({ default: WorkspaceUsagePage })));
const WorkspaceSettings = lazy(() => import("./WorkspaceSettings").then(({ WorkspaceSettings }) => ({ default: WorkspaceSettings })));

type WorkspaceControlCenterProps = {
  section: WorkspaceSection;
  workspace: Workspace;
  token: string;
  onSectionChange: (section: WorkspaceSection) => void;
  onAsk?: (question: string) => void;
};

export function WorkspaceControlCenter({ section, workspace, token, onSectionChange, onAsk }: WorkspaceControlCenterProps) {
  const { t } = useLocale();
  return (
    <section className="space-y-6">
      <WorkspaceSectionNav activeSection={section} role={workspace.role} onChange={onSectionChange} />
      <section className="space-y-8">
        <Suspense key={`${workspace.tenantId}:${workspace.role}:${section}`} fallback={<p role="status" className="empty-state">{t("Opening section…", "Abrindo a seção…")}</p>}>
          <WorkspaceSectionContent section={section} workspace={workspace} token={token} onSectionChange={onSectionChange} onAsk={onAsk} />
        </Suspense>
      </section>
    </section>
  );
}

function WorkspaceSectionContent({ section, workspace, token, onSectionChange, onAsk }: WorkspaceControlCenterProps) {
  const { t } = useLocale();
  if (!canAccessWorkspaceSection(section, workspace.role)) {
    const messages = {
      team: t("Only workspace owners can manage members and invitations.", "Somente proprietários podem gerenciar membros e convites."),
      evaluations: t("Evaluations are available to workspace owners.", "As avaliações estão disponíveis para proprietários."),
      usage: t("Usage and costs are available to workspace owners.", "Uso e custos estão disponíveis para proprietários."),
      settings: t("Workspace settings are available to owners.", "As configurações do espaço estão disponíveis para proprietários.")
    };
    const message = section === "team" || section === "evaluations" || section === "settings" || section === "usage" ? messages[section] : null;
    return <p className="empty-state">{message}</p>;
  }
  switch (section) {
    case "overview": return <WorkspaceOverview workspace={workspace} token={token} onNavigate={onSectionChange} />;
    case "knowledge": return <WorkspaceKnowledge workspace={workspace} token={token} onAsk={onAsk} />;
    case "processing": return <WorkspaceProcessing workspace={workspace} token={token} />;
    case "team": return <WorkspaceTeam workspaceId={workspace.tenantId} token={token} />;
    case "evaluations": return <WorkspaceEvaluations workspaceId={workspace.tenantId} token={token} />;
    case "usage": return <WorkspaceUsagePage workspaceId={workspace.tenantId} token={token} />;
    case "settings": return <WorkspaceSettings workspace={workspace} token={token} />;
  }
}
