import type { Workspace } from "../../../shared/api/rag-api";
import type { Translate } from "../../../shared/i18n/locale";

export function workspaceRoleLabel(role: Workspace["role"], t: Translate): string {
  return { owner: t("Owner", "Proprietário"), editor: t("Editor", "Editor"), viewer: t("Viewer", "Leitor") }[role];
}
