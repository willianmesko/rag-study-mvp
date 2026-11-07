import { Suspense } from "react";
import { lazyWithRecovery } from "../../../shared/ui/SectionErrorBoundary";
import type { Workspace } from "../../../shared/api/rag-api";
import { canAccessWorkspaceSection, type WorkspaceSection } from "../../../shared/lib/app-route";
import { useLocale } from "../../../shared/i18n/locale";
import { WorkspaceOverview } from "./WorkspaceOverview";
import { WorkspaceSectionNav } from "./WorkspaceSectionNav";
import { useQueryIdentity } from "../../../shared/lib/query-identity";
import { useIngestionMonitor } from "../model/use-ingestion-monitor";

const WorkspaceKnowledge = lazyWithRecovery(async () => ({ default: (await import("./WorkspaceKnowledge")).WorkspaceKnowledge }), "workspace");
const WorkspaceProcessing = lazyWithRecovery(async () => ({ default: (await import("./WorkspaceProcessing")).WorkspaceProcessing }), "workspace");
const WorkspaceTeam = lazyWithRecovery(async () => ({ default: (await import("./WorkspaceTeam")).WorkspaceTeam }), "workspace");
const WorkspaceEvaluations = lazyWithRecovery(async () => ({ default: (await import("./WorkspaceEvaluations")).WorkspaceEvaluations }), "workspace");
const WorkspaceUsagePage = lazyWithRecovery(async () => ({ default: (await import("./WorkspaceUsagePage")).WorkspaceUsagePage }), "workspace");
const WorkspaceSettings = lazyWithRecovery(async () => ({ default: (await import("./WorkspaceSettings")).WorkspaceSettings }), "workspace");

type WorkspaceControlCenterProps = {
  section: WorkspaceSection;
  workspace: Workspace;
  token: string;
  onSectionChange: (section: WorkspaceSection) => void;
  onAsk?: (question: string) => void;
};

export function WorkspaceControlCenter({ section, workspace, token, onSectionChange, onAsk }: WorkspaceControlCenterProps) {
  const { t } = useLocale();
  const userId = useQueryIdentity();
  useIngestionMonitor(token, workspace.tenantId, userId);
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
