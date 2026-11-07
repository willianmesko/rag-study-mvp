import type { DocumentFilters } from "@rag-study/contracts";
import type { Workspace } from "../api/rag-api";

export type WorkspaceSection = "overview" | "knowledge" | "processing" | "team" | "evaluations" | "usage" | "settings";
export type LabRoute =
  | { tab: "ingest" | "search" | "answer" | "history" | "connections"; workspaceSection?: never }
  | { tab: "admin"; workspaceSection: WorkspaceSection };

export type AppRoute =
  | { kind: "home" | "sign-in" | "onboarding" }
  | { kind: "mcp-consent"; requestId: string | null }
  | { kind: "demo" | "private"; lab: LabRoute };

const workspaceSections = new Set<WorkspaceSection>(["overview", "knowledge", "processing", "team", "evaluations", "usage", "settings"]);

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


// RFC UUID route grammar, parity-tested against the shared API schema.
const uuid = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
const metadataFilters = ["documentId", "language", "format", "from", "to"] as const;
function routeParts(location: string) {
  const [path, query] = location.split("?");
  return { path: path.replace(/\/+$/, "") || "/", params: new URLSearchParams(query) };
}

export function conversationIdFromLocation(location: string): string | null {
  const { path, params } = routeParts(location);
  if (path !== "/ask" || params.getAll("conversation").length !== 1) return null;
  const value = params.get("conversation");
  return value && uuid.test(value) ? value.toLowerCase() : null;
}
export function conversationPath(id: string | null): string {
  return id && uuid.test(id) ? `/ask?conversation=${encodeURIComponent(id.toLowerCase())}` : "/ask";
}

// URL grammar only: form/API payloads still use the complete shared Zod schema.
// Keep this bootstrap parser small; parity cases guard the metadata subset.
function validMetadata(input: Record<string, string>): input is Record<string, string> & DocumentFilters {
  const { documentId, language, format, from, to } = input;
  const validDate = (value: string | undefined) => {
    if (value === undefined) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
    const time = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  };
  return (documentId === undefined || uuid.test(documentId)) &&
    (language === undefined || ["en", "pt", "mixed", "und"].includes(language)) &&
    (format === undefined || ["pdf", "docx", "html", "markdown", "text"].includes(format)) &&
    validDate(from) && validDate(to) && (!from || !to || from <= to);
}

export function documentFiltersFromLocation(location: string): DocumentFilters {
  const { path, params } = routeParts(location);
  if (path !== "/workspace/knowledge") return {};
  const input = Object.fromEntries(metadataFilters.flatMap((key) => {
    const values = params.getAll(key); return values.length === 1 ? [[key, values[0]]] : [];
  }));
  if (input.documentId) input.documentId = input.documentId.toLowerCase();
  return validMetadata(input) ? input : {};
}
export function knowledgePath(filters: DocumentFilters): string {
  // Free-text search/source drafts stay local; URLs carry only safe metadata.
  const input = Object.fromEntries(metadataFilters.flatMap((key) => filters[key] === undefined ? [] : [[key, filters[key]]]));
  if (!validMetadata(input)) return "/workspace/knowledge";
  const query = new URLSearchParams(metadataFilters.flatMap((key) => {
    const value = input[key]; return value === undefined ? [] : [[key, key === "documentId" ? value.toLowerCase() : value]];
  })).toString();
  return `/workspace/knowledge${query ? `?${query}` : ""}`;
}
export function canonicalPrivatePath(location: string): string {
  const route = readAppRoute(location);
  if (route.kind !== "private") return "/workspace/overview";
  if (route.lab.tab === "answer") return conversationPath(conversationIdFromLocation(location));
  if (route.lab.tab === "admin" && route.lab.workspaceSection === "knowledge") return knowledgePath(documentFiltersFromLocation(location));
  return pathForTab(route.lab.tab, route.lab.workspaceSection);
}
