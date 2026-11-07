import { useState } from "react";
import { WorkspaceCreationForm } from "../../../features/workspace-creation/ui/WorkspaceCreationForm";
import type { Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { SelectField } from "../../../shared/ui/SelectField";

export type WorkspaceCreation = { accessToken: string; onWorkspaceCreated: (workspace: Workspace) => void };

export function WorkspaceSwitcher({ workspaces, selectedId, onChange, creation }: {
  workspaces: Workspace[];
  selectedId: string;
  onChange: (workspaceId: string) => void;
  creation?: WorkspaceCreation;
}) {
  const { t } = useLocale();
  const [creating, setCreating] = useState(false);
  if (workspaces.length === 0) return null;
  const roles = { owner: t("Owner", "Proprietário"), editor: t("Editor", "Editor"), viewer: t("Viewer", "Leitor") };
  const select = (
    <SelectField className="w-full sm:w-56" label={t("Workspace", "Espaço de trabalho")}
      value={selectedId} onValueChange={onChange}
      options={workspaces.map((workspace) => ({
        value: workspace.tenantId,
        label: workspace.tenantName,
        description: roles[workspace.role]
      }))} />
  );
  if (!creation) return select;

  return (
    <div className="flex w-full min-w-0 flex-wrap items-end gap-2 sm:w-auto" role="group" aria-label={t("Workspace controls", "Controles do espaço de trabalho")}>
      {select}
      <button type="button" className="secondary-button min-h-11 w-full sm:w-auto" aria-haspopup="dialog"
        onClick={(event) => { event.currentTarget.focus(); setCreating(true); }}>
        <span aria-hidden="true">+</span> {t("New workspace", "Novo espaço")}
      </button>
      {creating && <WorkspaceCreationForm {...creation} onDismiss={() => setCreating(false)} />}
    </div>
  );
}
