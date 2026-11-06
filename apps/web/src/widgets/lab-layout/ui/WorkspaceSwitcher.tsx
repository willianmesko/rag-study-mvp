import type { Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { SelectField } from "../../../shared/ui/SelectField";

export function WorkspaceSwitcher({ workspaces, selectedId, onChange }: { workspaces: Workspace[]; selectedId: string; onChange: (workspaceId: string) => void }) {
  const { t } = useLocale();
  if (workspaces.length === 0) return null;
  const roles = { owner: t("Owner", "Proprietário"), editor: t("Editor", "Editor"), viewer: t("Viewer", "Leitor") };
  return (
    <SelectField className="w-full sm:w-56" label={t("Workspace", "Espaço de trabalho")}
      value={selectedId} onValueChange={onChange}
      options={workspaces.map((workspace) => ({
        value: workspace.tenantId,
        label: workspace.tenantName,
        description: roles[workspace.role]
      }))} />
  );
}
