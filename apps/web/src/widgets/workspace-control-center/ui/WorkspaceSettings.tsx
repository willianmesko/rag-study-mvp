import { WorkspaceChatPolicy } from "../../../features/workspace-model-policy/ui/WorkspaceChatPolicy";
import { WorkspaceMcpConnection } from "../../../features/workspace-mcp/ui/WorkspaceMcpConnection";
import type { Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { workspaceRoleLabel } from "../model/labels";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

export function WorkspaceSettings({ workspace, token }: { workspace: Workspace; token: string }) {
  const { t } = useLocale();

  return (
    <div className="space-y-5">
      <WorkspacePageHeader title={t("Settings", "Configurações")} />
      <section className="border-b border-slate-800 pb-6">
        <h2 className="text-base font-semibold text-slate-100">{t("Workspace profile", "Perfil do espaço")}</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {[
            [t("Name", "Nome"), workspace.tenantName],
            [t("Workspace URL", "Endereço do espaço"), workspace.tenantSlug],
            [t("Your role", "Seu perfil"), workspaceRoleLabel(workspace.role, t)],
            [t("Data access", "Acesso aos dados"), t("Isolated to this workspace", "Restrito a este espaço")]
          ].map(([label, value]) => (
            <div className="min-w-0" key={label}>
              <dt className="text-xs text-slate-400">{label}</dt>
              <dd className="mt-2 break-words text-sm text-slate-100">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <WorkspaceChatPolicy token={token} workspaceId={workspace.tenantId} />
      <WorkspaceMcpConnection key={workspace.tenantId} token={token} workspaceId={workspace.tenantId} />
    </div>
  );
}
