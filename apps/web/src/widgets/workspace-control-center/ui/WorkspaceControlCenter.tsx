import type { Workspace } from "../../../shared/api/rag-api";
import type { WorkspaceSection } from "../../../shared/lib/app-route";
import { useLocale } from "../../../shared/i18n/locale";
import { WorkspaceSectionNav } from "./WorkspaceSectionNav";
import { AdminPanel } from "../../admin-corpus/ui/AdminPanel";

export function WorkspaceControlCenter({ section, workspace, token, onSectionChange }: {
  section: WorkspaceSection;
  workspace: Workspace;
  token: string;
  onSectionChange: (section: WorkspaceSection) => void;
}) {
  const { t } = useLocale();

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
      <AdminPanel key={workspace.tenantId} section={section} workspace={workspace} token={token} onSectionChange={onSectionChange} />
    </section>
  );
}
