import type { Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";

export function WorkspaceSwitcher({ workspaces, selectedId, onChange }: { workspaces: Workspace[]; selectedId: string; onChange: (workspaceId: string) => void }) {
  const { t } = useLocale();
  if (workspaces.length === 0) return null;
  const roles = { owner: t("Owner", "Proprietário"), editor: t("Editor", "Editor"), viewer: t("Viewer", "Leitor") };
  return (
    <label className="workspace-switcher min-w-0 max-w-full">
      <span className="workspace-switcher__label">{t("Workspace", "Espaço de trabalho")}</span>
      <select value={selectedId} onChange={(event) => onChange(event.target.value)}>
        {workspaces.map((workspace) => <option key={workspace.tenantId} value={workspace.tenantId}>{workspace.tenantName} · {roles[workspace.role]}</option>)}
      </select>
    </label>
  );
}
