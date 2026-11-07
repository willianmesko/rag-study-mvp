import type { Workspace } from "../api/rag-api";

export type WorkspaceSection = "overview" | "knowledge" | "processing" | "team" | "evaluations" | "settings";
export type LabRoute =
  | { tab: "ingest" | "search" | "answer" | "history"; workspaceSection?: never }
  | { tab: "admin"; workspaceSection: WorkspaceSection };

export type AppRoute =
  | { kind: "home" | "sign-in" | "onboarding" }
  | { kind: "demo" | "private"; lab: LabRoute };

const workspaceSections = new Set<WorkspaceSection>(["overview", "knowledge", "processing", "team", "evaluations", "settings"]);

export function canAccessWorkspaceSection(section: WorkspaceSection, role: Workspace["role"]): boolean {
  return role === "owner" || ((role === "editor" || role === "viewer") &&
    (section === "overview" || section === "knowledge" || section === "processing"));
}

export function readAppRoute(pathname: string): AppRoute {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/sign-in") return { kind: "sign-in" };
  if (normalized === "/onboarding") return { kind: "onboarding" };
  if (normalized === "/demo" || normalized === "/demo/search") return { kind: "demo", lab: { tab: "search" } };
  if (normalized === "/demo/ask") return { kind: "demo", lab: { tab: "answer" } };
  if (normalized === "/demo/history") return { kind: "demo", lab: { tab: "history" } };
  if (normalized === "/demo/index" || normalized === "/index") return { kind: "demo", lab: { tab: "ingest" } };
  const workspaceMatch = normalized.match(/^\/workspace(?:\/([^/]+))?$/);
  if (workspaceMatch) {
    const candidate = workspaceMatch[1] as WorkspaceSection | undefined;
    return { kind: "private", lab: { tab: "admin", workspaceSection: candidate && workspaceSections.has(candidate) ? candidate : "overview" } };
  }
  if (normalized === "/search") return { kind: "private", lab: { tab: "search" } };
  if (normalized === "/ask") return { kind: "private", lab: { tab: "answer" } };
  if (normalized === "/history") return { kind: "private", lab: { tab: "history" } };
  return { kind: "home" };
}

export function pathForTab(tab: LabRoute["tab"], workspaceSection: WorkspaceSection = "overview", demo = false): string {
  if (tab === "admin") return `/workspace/${workspaceSection}`;
  const prefix = demo ? "/demo" : "";
  if (tab === "search") return demo ? "/demo" : "/search";
  if (tab === "answer") return `${prefix}/ask`;
  if (tab === "history") return `${prefix}/history`;
  return "/demo/index";
}

export function navigateTo(pathname: string, { replace = false }: { replace?: boolean } = {}): void {
  if (window.location.pathname === pathname) return;
  if (replace) window.history.replaceState({}, "", pathname);
  else window.history.pushState({}, "", pathname);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
