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
  sources: Array<{ source: string; title: string | null; chunk: number; score: number }>;
};
export type UploadJob = { id: string; source: string; title: string | null; filename: string; mimeType: string; status: "queued" | "processing" | "completed" | "failed"; progress: number; error: string | null; chunkCount: number | null; highRiskChunks: number | null; createdAt: string; updatedAt: string };

type ErrorBody = { error?: string; message?: string };

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

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

export const api = {
  health: () => request<Health>("/health"),
  ingest: (input: { source: string; title?: string; text: string; metadata: Record<string, unknown> }) =>
    request<IngestResponse>("/v1/documents", { method: "POST", body: JSON.stringify(input) }),
  search: (input: { query: string; topK: number }) =>
    request<SearchResponse>(`/v1/search?${new URLSearchParams({ q: input.query, topK: String(input.topK) })}`),
  answer: (input: { question: string; topK: number }) => request<QuestionResponse>("/v1/qa", { method: "POST", body: JSON.stringify(input) }),
  listUploads: (accessToken: string) => request<{ jobs: UploadJob[] }>("/v1/admin/uploads", { headers: { authorization: `Bearer ${accessToken}` } }),
  retryUpload: (jobId: string, accessToken: string) => request<{ jobId: string; status: string }>(`/v1/admin/uploads/${jobId}/retry`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } }),
  uploadDocument: async (input: { file: File; source: string; title?: string; accessToken: string }) => {
    const body = new FormData(); body.append("file", input.file);
    const response = await fetch(`${apiBaseUrl}/v1/admin/uploads`, { method: "POST", body, headers: { authorization: `Bearer ${input.accessToken}`, "x-document-source": input.source, ...(input.title ? { "x-document-title": input.title } : {}) } });
    if (!response.ok) { const error = await response.json().catch(() => ({})) as ErrorBody; throw new ApiError(error.error ?? "Não foi possível enviar o arquivo.", response.status); }
    return response.json() as Promise<{ job: UploadJob }>;
  }
};

