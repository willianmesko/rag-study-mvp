export type Health = { status: string };

export type SearchResult = {
  chunkId: string;
  documentId: string;
  ordinal: number;
  content: string;
  source: string;
  title: string | null;
  score: number;
  security: {
    promptInjectionRisk: "low" | "medium" | "high";
    signals: string[];
  };
  retrieval?: {
    vectorRank: number | null;
    keywordRank: number | null;
    fusionScore: number;
  };
  reranker?: {
    rank: number;
    score: number;
  };
};

export type SearchResponse = { results: SearchResult[] };
export type IngestResponse = { documentId: string; chunkCount: number; highRiskChunks: number };
export type QuestionResponse = {
  answer: string;
  sources: Array<{ chunkId: string; documentId: string; source: string; title: string | null; chunk: number; score: number; excerpt: string }>;
};
export type UploadJob = { id: string; source: string; title: string | null; filename: string; mimeType: string; status: "queued" | "processing" | "completed" | "failed"; progress: number; error: string | null; chunkCount: number | null; highRiskChunks: number | null; createdAt: string; updatedAt: string };
export type ManagedDocument = { id: string; source: string; title: string | null; chunkCount: number; createdAt: string; updatedAt: string };
export type StoredChunk = { id: string; ordinal: number; content: string; security: SearchResult["security"]; createdAt: string };
export type Workspace = { tenantId: string; tenantName: string; tenantSlug: string; role: "owner" | "editor" | "viewer" };
export type WorkspaceMember = { userId: string; email: string | null; role: Workspace["role"]; createdAt: string };

type ErrorBody = { error?: string; message?: string };

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const workspaceHeaders = (workspaceId?: string): Record<string, string> => workspaceId ? { "x-workspace-id": workspaceId } : {};

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    throw new ApiError(body.error ?? body.message ?? "Não foi possível concluir a solicitação.", response.status);
  }
  return response.json() as Promise<T>;
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    throw new ApiError(body.error ?? body.message ?? "Não foi possível concluir a solicitação.", response.status);
  }
}

export const api = {
  workspaces: (accessToken: string) => request<{ workspaces: Workspace[] }>("/v1/workspaces", { headers: { authorization: `Bearer ${accessToken}` } }),
  createWorkspace: (input: { name: string; slug: string; accessToken: string }) => request<{ workspace: Workspace }>("/v1/workspaces", { method: "POST", body: JSON.stringify({ name: input.name, slug: input.slug }), headers: { authorization: `Bearer ${input.accessToken}` } }),
  listWorkspaceMembers: (workspaceId: string, accessToken: string) => request<{ members: WorkspaceMember[] }>(`/v1/workspaces/${workspaceId}/members`, { headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  inviteWorkspaceMember: (input: { workspaceId: string; email: string; role: "editor" | "viewer"; accessToken: string }) => request<{ member: Omit<WorkspaceMember, "createdAt"> }>(`/v1/workspaces/${input.workspaceId}/invitations`, { method: "POST", body: JSON.stringify({ email: input.email, role: input.role }), headers: { authorization: `Bearer ${input.accessToken}`, ...workspaceHeaders(input.workspaceId) } }),
  changeWorkspaceMemberRole: (input: { workspaceId: string; userId: string; role: "editor" | "viewer"; accessToken: string }) => requestVoid(`/v1/workspaces/${input.workspaceId}/members/${input.userId}`, { method: "PATCH", body: JSON.stringify({ role: input.role }), headers: { authorization: `Bearer ${input.accessToken}`, ...workspaceHeaders(input.workspaceId) } }),
  removeWorkspaceMember: (input: { workspaceId: string; userId: string; accessToken: string }) => requestVoid(`/v1/workspaces/${input.workspaceId}/members/${input.userId}`, { method: "DELETE", headers: { authorization: `Bearer ${input.accessToken}`, ...workspaceHeaders(input.workspaceId) } }),
  health: () => request<Health>("/health"),
  ingest: (input: { source: string; title?: string; text: string; metadata: Record<string, unknown> }) =>
    request<IngestResponse>("/v1/documents", { method: "POST", body: JSON.stringify(input) }),
  search: (input: { query: string; topK: number }) =>
    request<SearchResponse>(`/v1/search?${new URLSearchParams({ q: input.query, topK: String(input.topK) })}`),
  answer: (input: { question: string; topK: number }) => request<QuestionResponse>("/v1/qa", { method: "POST", body: JSON.stringify(input) }),
  listUploads: (accessToken: string, workspaceId?: string) => request<{ jobs: UploadJob[] }>("/v1/admin/uploads", { headers: { authorization: `Bearer ${accessToken}`, ...(workspaceId ? { "x-workspace-id": workspaceId } : {}) } }),
  retryUpload: (jobId: string, accessToken: string, workspaceId?: string) => request<{ jobId: string; status: string }>(`/v1/admin/uploads/${jobId}/retry`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  listDocuments: (accessToken: string, workspaceId?: string) => request<{ documents: ManagedDocument[] }>("/v1/admin/documents", { headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  listDocumentChunks: (documentId: string, accessToken: string, workspaceId?: string) => request<{ chunks: StoredChunk[] }>(`/v1/admin/documents/${documentId}/chunks`, { headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  reindexDocument: (documentId: string, accessToken: string, workspaceId?: string) => request<{ job: UploadJob }>(`/v1/admin/documents/${documentId}/reindex`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  deleteDocument: (documentId: string, accessToken: string, workspaceId?: string) => requestVoid(`/v1/admin/documents/${documentId}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  uploadDocument: async (input: { file: File; source: string; title?: string; accessToken: string; workspaceId?: string }) => {
    const body = new FormData(); body.append("file", input.file);
    const response = await fetch(`${apiBaseUrl}/v1/admin/uploads`, { method: "POST", body, headers: { authorization: `Bearer ${input.accessToken}`, ...workspaceHeaders(input.workspaceId), "x-document-source": input.source, ...(input.title ? { "x-document-title": input.title } : {}) } });
    if (!response.ok) { const error = await response.json().catch(() => ({})) as ErrorBody; throw new ApiError(error.error ?? "Não foi possível enviar o arquivo.", response.status); }
    return response.json() as Promise<{ job: UploadJob }>;
  }
};

