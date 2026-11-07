import type { Workspace } from "../../shared/api/rag-api";
import { canAccessWorkspaceSection, canonicalPrivatePath, readAppRoute, type LabRoute } from "../../shared/lib/app-route";

const askPath = "/ask";
const overviewPath = "/workspace/overview";

export function canViewRoute(lab: LabRoute, role: Workspace["role"]): boolean {
  return lab.tab !== "admin" || canAccessWorkspaceSection(lab.workspaceSection, role);
}

export function accessibleWorkspacePath(path: string | null, role: Workspace["role"]): string {
  if (!path) return askPath;
  const route = readAppRoute(path);
  return route.kind === "private" && canViewRoute(route.lab, role) ? canonicalPrivatePath(path) : overviewPath;
}
