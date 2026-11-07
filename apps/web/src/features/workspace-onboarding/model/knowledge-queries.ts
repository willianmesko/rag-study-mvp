import { queryOptions } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import { privateQueryKey } from "../../../shared/lib/query-keys";

export const guideDocumentsQuery = (token: string, workspaceId: string, userId: string | null) => queryOptions({
  queryKey: privateQueryKey("guide-documents", userId, workspaceId), retry: false,
  queryFn: ({ signal }) => api.listDocuments(token, workspaceId, AbortSignal.any([signal, AbortSignal.timeout(10_000)]))
});

export const guideJobsQuery = (token: string, workspaceId: string, userId: string | null) => queryOptions({
  queryKey: privateQueryKey("guide-jobs", userId, workspaceId), retry: false,
  queryFn: ({ signal }) => api.listUploads(token, workspaceId, AbortSignal.any([signal, AbortSignal.timeout(10_000)])),
  refetchInterval: (query) => !query.state.error && query.state.data?.jobs.some(({ status }) => status === "queued" || status === "processing") ? 2_000 : false
});
