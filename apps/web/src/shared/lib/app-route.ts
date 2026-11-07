import type { Workspace } from "../api/rag-api";

export type WorkspaceSection = "overview" | "knowledge" | "processing" | "team" | "evaluations" | "settings";
export type LabRoute =
  | { tab: "ingest" | "search" | "answer" | "history" | "connections"; workspaceSection?: never }
  | { tab: "admin"; workspaceSection: WorkspaceSection };

export type AppRoute =
  | { kind: "home" | "sign-in" | "onboarding" }
  | { kind: "mcp-consent"; requestId: string | null }
  | { kind: "demo" | "private"; lab: LabRoute };

const workspaceSections = new Set<WorkspaceSection>(["overview", "knowledge", "processing", "team", "evaluations", "settings"]);

export function canAccessWorkspaceSection(section: WorkspaceSection, role: Workspace["role"]): boolean {
  return role === "owner" || ((role === "editor" || role === "viewer") &&
    (section === "overview" || section === "knowledge" || section === "processing"));
}

export function readAppRoute(pathname: string): AppRoute {
  const [path, query] = pathname.split("?");
  const normalized = path.replace(/\/+$/, "") || "/";
  if (normalized === "/mcp/authorize") {
    const params = new URLSearchParams(query);
    const id = params.get("requestId");
    return { kind: "mcp-consent", requestId: params.getAll("requestId").length === 1 && id && /^[0-9a-f-]{36}$/i.test(id) ? id : null };
  }
  if (normalized === "/sign-in") return { kind: "sign-in" };
  if (normalized === "/onboarding") return { kind: "onboarding" };
  if (normalized === "/demo/search") return { kind: "demo", lab: { tab: "search" } };
  if (normalized === "/demo" || normalized === "/demo/ask") return { kind: "demo", lab: { tab: "answer" } };
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
  if (normalized === "/connections") return { kind: "private", lab: { tab: "connections" } };
  return { kind: "home" };
}

export function pathForTab(tab: LabRoute["tab"], workspaceSection: WorkspaceSection = "overview", demo = false): string {
  if (tab === "admin") return `/workspace/${workspaceSection}`;
  const prefix = demo ? "/demo" : "";
  if (tab === "search") return demo ? "/demo/search" : "/search";
  if (tab === "answer") return `${prefix}/ask`;
  if (tab === "history") return `${prefix}/history`;
  if (tab === "connections") return "/connections";
  return "/demo/index";
}

export function navigateTo(pathname: string, { replace = false }: { replace?: boolean } = {}): void {
  if (window.location.pathname + window.location.search === pathname) return;
  if (replace) window.history.replaceState({}, "", pathname);
  else window.history.pushState({}, "", pathname);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
