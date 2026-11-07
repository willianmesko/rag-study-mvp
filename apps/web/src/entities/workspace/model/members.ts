import { queryOptions } from "@tanstack/react-query";
import { api, type Workspace } from "../../../shared/api/rag-api";
import type { Translate } from "../../../shared/i18n/locale";

export const membersQuery = (token: string, workspaceId: string) => queryOptions({
  queryKey: ["workspace-members", token, workspaceId], retry: false,
  queryFn: ({ signal }) => api.listWorkspaceMembers(workspaceId, token, AbortSignal.any([signal, AbortSignal.timeout(10_000)]))
});

export function workspaceRoleLabel(role: Workspace["role"], t: Translate): string {
  return { owner: t("Owner", "Proprietário"), editor: t("Editor", "Editor"), viewer: t("Viewer", "Leitor") }[role];
}
