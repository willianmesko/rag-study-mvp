import { chatModelCatalogSchema, questionComparisonResponseSchema, workspaceChatModelPolicyResponseSchema, workspaceOnboardingResponseSchema,
  mcpAccessIssuedSchema, mcpAccessStatusSchema,
  type QuestionComparisonInput, type WorkspaceChatModelPolicy, type WorkspaceOnboardingProgress } from "@rag-study/contracts";

export type Health = { status: string };

export type SearchResult = {
  chunkId: string;
  documentId: string;
  ordinal: number;
  content: string;
  source: string;
  title: string | null;
  score: number;
  previewTruncated?: boolean;
  previewBlocked?: boolean;
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
export type { QuestionResponse, QuestionSource } from "@rag-study/contracts";
export type UploadJob = { id: string; source: string; title: string | null; filename: string; mimeType: string; status: "queued" | "processing" | "completed" | "failed"; progress: number; error: string | null; chunkCount: number | null; highRiskChunks: number | null; createdAt: string; updatedAt: string };
export type IngestionEvent = { id: string; stage: string; status: "started" | "completed" | "failed" | "info"; durationMs: number | null; details: Record<string, unknown>; createdAt: string };
type IngestionPassagePreview = {
  totalChunks: number;
  passages: Array<{ chunkId: string; chunk: number; excerpt: string; excerptTruncated: boolean; previewBlocked: boolean }>;
};
export type ManagedDocument = {
  id: string;
  source: string;
  title: string | null;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  hasOriginal?: boolean;
  format?: string;
  language?: "pt" | "en" | "mixed" | "unknown" | "und";
  sectionCount?: number;
};
type OriginalDocumentFile = { blob: Blob; filename: string; isPdf: boolean };
export type StoredChunk = { id: string; ordinal: number; content: string; security: SearchResult["security"]; createdAt: string };
export type Workspace = { tenantId: string; tenantName: string; tenantSlug: string; role: "owner" | "editor" | "viewer" };
export type WorkspaceMember = { userId: string; email: string | null; role: Workspace["role"]; createdAt: string };
export type UsageSummary = { requests: number; cacheHits: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; averageLatencyMs: number; providerFailures: number };
export type UsageAlert = { thresholdUsd: number; triggered: boolean };
export type EvaluationRun = {
  id: string;
  tenantId: string;
  datasetName: string;
  datasetVersion: string;
  commitSha: string | null;
  embeddingProvider: string;
  embeddingModel: string;
  chatProvider: string;
  chatModel: string;
  totalCases: number;
  hitRate: number;
  meanReciprocalRank: number;
  faithfulness: number | null;
  contextPrecision: number | null;
  injectionPassRate: number;
  passed: boolean;
  durationMs: number;
  failureDetails: Record<string, unknown>;
  createdAt: string;
};

type ErrorBody = { error?: string; message?: string };

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const workspaceHeaders = (workspaceId?: string): Record<string, string> => workspaceId ? { "x-workspace-id": workspaceId } : {};

function originalFilename(disposition: string | null, fallback: string): string {
  const encoded = disposition?.match(/(?:^|;)\s*filename\*\s*=\s*UTF-8'[^']*'([^;]+)/i)?.[1];
  if (!encoded) return fallback;
  try {
    const filename = decodeURIComponent(encoded.trim()).replace(/[/\\\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, "_").trim();
    return filename && filename !== "." && filename !== ".." ? filename : fallback;
  } catch {
    return fallback;
  }
}

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
    throw new ApiError(body.error ?? body.message ?? "The request could not be completed.", response.status);
  }
  return response.json() as Promise<T>;
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    throw new ApiError(body.error ?? body.message ?? "The request could not be completed.", response.status);
  }
}

export const api = {
  workspaceMcpAccess: async (accessToken: string, workspaceId: string, signal: AbortSignal) => {
    try {
      return mcpAccessStatusSchema.parse(await request<unknown>("/v1/mcp/access", {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) }
      }));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  issueWorkspaceMcpAccess: async (accessToken: string, workspaceId: string) => mcpAccessIssuedSchema.parse(
    await request<unknown>("/v1/mcp/access", {
      method: "POST", headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) },
      signal: AbortSignal.timeout(10_000)
    })),
  revokeWorkspaceMcpAccess: (accessToken: string, workspaceId: string) => requestVoid("/v1/mcp/access", {
    method: "DELETE", headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) },
    signal: AbortSignal.timeout(10_000)
  }),
  workspaces: (accessToken: string) => request<{ workspaces: Workspace[] }>("/v1/workspaces", { headers: { authorization: `Bearer ${accessToken}` } }),
  createWorkspace: (input: { name: string; slug: string; accessToken: string }) => request<{ workspace: Workspace }>("/v1/workspaces", { method: "POST", body: JSON.stringify({ name: input.name, slug: input.slug }), headers: { authorization: `Bearer ${input.accessToken}` } }),
  getOnboardingProgress: async (workspaceId: string, accessToken: string, signal: AbortSignal) => {
    const response = await request<unknown>(`/v1/workspaces/${workspaceId}/onboarding`, {
      headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)])
    });
    return workspaceOnboardingResponseSchema.parse(response).progress;
  },
  saveOnboardingProgress: async (workspaceId: string, accessToken: string, progress: WorkspaceOnboardingProgress) => {
    const response = await request<unknown>(`/v1/workspaces/${workspaceId}/onboarding`, {
      method: "PATCH", body: JSON.stringify(progress),
      headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) },
      signal: AbortSignal.timeout(10_000)
    });
    const saved = workspaceOnboardingResponseSchema.parse(response).progress;
    if (!saved) throw new Error("The guide progress was not saved.");
    return saved;
  },
  listWorkspaceMembers: (workspaceId: string, accessToken: string) => request<{ members: WorkspaceMember[] }>(`/v1/workspaces/${workspaceId}/members`, { headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  inviteWorkspaceMember: (input: { workspaceId: string; email: string; role: "editor" | "viewer"; accessToken: string }) => request<{ member: Omit<WorkspaceMember, "createdAt"> }>(`/v1/workspaces/${input.workspaceId}/invitations`, { method: "POST", body: JSON.stringify({ email: input.email, role: input.role }), headers: { authorization: `Bearer ${input.accessToken}`, ...workspaceHeaders(input.workspaceId) } }),
  changeWorkspaceMemberRole: (input: { workspaceId: string; userId: string; role: "editor" | "viewer"; accessToken: string }) => requestVoid(`/v1/workspaces/${input.workspaceId}/members/${input.userId}`, { method: "PATCH", body: JSON.stringify({ role: input.role }), headers: { authorization: `Bearer ${input.accessToken}`, ...workspaceHeaders(input.workspaceId) } }),
  removeWorkspaceMember: (input: { workspaceId: string; userId: string; accessToken: string }) => requestVoid(`/v1/workspaces/${input.workspaceId}/members/${input.userId}`, { method: "DELETE", headers: { authorization: `Bearer ${input.accessToken}`, ...workspaceHeaders(input.workspaceId) } }),
  health: () => request<Health>("/health"),
  ingest: (input: DocumentInput) =>
    request<IngestResponse>("/v1/documents", { method: "POST", body: JSON.stringify(input) }),
  search: (input: SearchInput & { accessToken?: string; workspaceId?: string }) =>
    request<SearchResponse>(`/v1/search?${new URLSearchParams({ q: input.query, topK: String(input.topK ?? 5) })}`, { headers: { ...(input.accessToken ? { authorization: `Bearer ${input.accessToken}` } : {}), ...workspaceHeaders(input.workspaceId) } }),
  answer: (input: QuestionInput & { accessToken?: string; workspaceId?: string; signal?: AbortSignal }) => request<QuestionResponse>("/v1/qa", {
    method: "POST", signal: input.signal,
    body: JSON.stringify({ question: input.question, topK: input.topK ?? 5, modelId: input.modelId, previousQuestions: input.previousQuestions }),
    headers: { ...(input.accessToken ? { authorization: `Bearer ${input.accessToken}` } : {}), ...workspaceHeaders(input.workspaceId) }
  }),
  chatModels: async (accessToken: string, workspaceId: string, signal: AbortSignal) => chatModelCatalogSchema.parse(await request<unknown>("/v1/qa/models", {
    headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) },
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  })),
  chatModelPolicy: async (accessToken: string, workspaceId: string, signal: AbortSignal) =>
    workspaceChatModelPolicyResponseSchema.parse(await request<unknown>("/v1/admin/chat-model-policy", {
      signal, headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) }
    })),
  saveChatModelPolicy: async (accessToken: string, workspaceId: string, policy: WorkspaceChatModelPolicy) =>
    workspaceChatModelPolicyResponseSchema.parse(await request<unknown>("/v1/admin/chat-model-policy", {
      method: "PATCH", body: JSON.stringify(policy), headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) }
    })),
  compareAnswers: async (input: QuestionComparisonInput, accessToken: string, workspaceId: string, signal: AbortSignal) =>
    questionComparisonResponseSchema.parse(await request<unknown>("/v1/qa/compare", {
      method: "POST", signal, body: JSON.stringify(input),
      headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) }
    })),
  listUploads: (accessToken: string, workspaceId?: string) => request<{ jobs: UploadJob[] }>("/v1/admin/uploads", { headers: { authorization: `Bearer ${accessToken}`, ...(workspaceId ? { "x-workspace-id": workspaceId } : {}) } }),
  listUploadEvents: (jobId: string, accessToken: string, workspaceId?: string) => request<{ events: IngestionEvent[] }>(`/v1/admin/uploads/${jobId}/events`, { headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  previewUploadPassages: (jobId: string, accessToken: string, workspaceId: string, signal: AbortSignal) =>
    request<IngestionPassagePreview>(`/v1/admin/uploads/${encodeURIComponent(jobId)}/preview`, {
      headers: { authorization: `Bearer ${accessToken}`, "x-workspace-id": workspaceId }, signal, cache: "no-store"
    }),
  getUsageSummary: (accessToken: string, workspaceId: string, days = 30) => request<{ days: number; summary: UsageSummary; alert: UsageAlert }>(`/v1/admin/usage?${new URLSearchParams({ days: String(days) })}`, { headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  listEvaluationRuns: (accessToken: string, workspaceId: string) => request<{ runs: EvaluationRun[]; faithfulnessEnabled?: boolean }>("/v1/admin/evaluations?limit=20", { headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  runEvaluation: (accessToken: string, workspaceId: string, options: { includeFaithfulness?: boolean; modelId?: string; effort?: "compact" | "standard" | "extended" } = {}) =>
    request<{ run: EvaluationRun }>("/v1/admin/evaluations/run", {
      method: "POST", body: JSON.stringify(options), headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) }
    }),
  retryUpload: (jobId: string, accessToken: string, workspaceId?: string) => request<{ jobId: string; status: string }>(`/v1/admin/uploads/${jobId}/retry`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  listDocuments: (accessToken: string, workspaceId?: string) => request<{ documents: ManagedDocument[] }>("/v1/admin/documents", { headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  getOriginalDocument: async (input: { documentId: string; accessToken: string; workspaceId: string; signal: AbortSignal }): Promise<OriginalDocumentFile> => {
    const response = await fetch(`${apiBaseUrl}/v1/admin/documents/${encodeURIComponent(input.documentId)}/original`, {
      headers: { authorization: `Bearer ${input.accessToken}`, "x-workspace-id": input.workspaceId },
      signal: input.signal,
      cache: "no-store",
      redirect: "error"
    });
    if (!response.ok) throw new ApiError("The original file could not be loaded.", response.status);
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const isPdf = contentType === "application/pdf";
    if (!isPdf && contentType !== "application/octet-stream") {
      throw new ApiError("The server returned an unexpected file format.", 502);
    }
    const filename = originalFilename(response.headers.get("content-disposition"), isPdf ? "original-file.pdf" : "original-file");
    return { blob: await response.blob(), filename, isPdf };
  },
  listDocumentChunks: (documentId: string, accessToken: string, workspaceId?: string) => request<{ chunks: StoredChunk[] }>(`/v1/admin/documents/${documentId}/chunks`, { headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  reindexDocument: (documentId: string, accessToken: string, workspaceId?: string) => request<{ job: UploadJob }>(`/v1/admin/documents/${documentId}/reindex`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  deleteDocument: (documentId: string, accessToken: string, workspaceId?: string) => requestVoid(`/v1/admin/documents/${documentId}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}`, ...workspaceHeaders(workspaceId) } }),
  importDocumentUrl: (input: { url: string; title?: string; accessToken: string; workspaceId: string }) =>
    request<{ job: UploadJob }>("/v1/admin/uploads/url", {
      method: "POST",
      headers: { authorization: `Bearer ${input.accessToken}`, "x-workspace-id": input.workspaceId },
      body: JSON.stringify({ url: input.url, title: input.title })
    }),
  uploadDocument: async (input: { file: File; source: string; title?: string; accessToken: string; workspaceId?: string }) => {
    const body = new FormData(); body.append("file", input.file);
    const response = await fetch(`${apiBaseUrl}/v1/admin/uploads`, { method: "POST", body, headers: { authorization: `Bearer ${input.accessToken}`, ...workspaceHeaders(input.workspaceId), "x-document-source": input.source, ...(input.title ? { "x-document-title": input.title } : {}) } });
    if (!response.ok) { const error = await response.json().catch(() => ({})) as ErrorBody; throw new ApiError(error.error ?? "The file could not be uploaded.", response.status); }
    return response.json() as Promise<{ job: UploadJob }>;
  }
};

import type { DocumentInput, QuestionInput, QuestionResponse, SearchInput } from "@rag-study/contracts";

