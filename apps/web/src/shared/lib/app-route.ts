export type WorkspaceSection = "overview" | "knowledge" | "processing" | "team" | "evaluations" | "settings";

export type AppRoute =
  | { tab: "ingest" | "search" | "answer" | "history"; workspaceSection?: never }
  | { tab: "admin"; workspaceSection: WorkspaceSection };

const workspaceSections = new Set<WorkspaceSection>(["overview", "knowledge", "processing", "team", "evaluations", "settings"]);

export function readAppRoute(pathname: string, publicDemo: boolean): AppRoute {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  const workspaceMatch = normalized.match(/^\/workspace(?:\/([^/]+))?$/);
  if (workspaceMatch) {
    const candidate = workspaceMatch[1] as WorkspaceSection | undefined;
    return { tab: "admin", workspaceSection: candidate && workspaceSections.has(candidate) ? candidate : "overview" };
  }
  if (normalized === "/search") return { tab: "search" };
  if (normalized === "/ask") return { tab: "answer" };
  if (normalized === "/history") return { tab: "history" };
  if (normalized === "/index" && !publicDemo) return { tab: "ingest" };
  return { tab: publicDemo ? "search" : "ingest" };
}

export function pathForTab(tab: AppRoute["tab"], workspaceSection: WorkspaceSection = "overview"): string {
  if (tab === "admin") return `/workspace/${workspaceSection}`;
  if (tab === "search") return "/search";
  if (tab === "answer") return "/ask";
  if (tab === "history") return "/history";
  return "/index";
}

export function navigateTo(pathname: string): void {
  if (window.location.pathname === pathname) return;
  window.history.pushState({}, "", pathname);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
