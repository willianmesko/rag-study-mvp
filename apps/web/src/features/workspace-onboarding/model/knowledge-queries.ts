import { queryOptions } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";

export const guideDocumentsQuery = (token: string, workspaceId: string) => queryOptions({
  queryKey: ["guide-documents", token, workspaceId], retry: false,
  queryFn: ({ signal }) => api.listDocuments(token, workspaceId, AbortSignal.any([signal, AbortSignal.timeout(10_000)]))
});

export const guideJobsQuery = (token: string, workspaceId: string) => queryOptions({
  queryKey: ["guide-jobs", token, workspaceId], retry: false,
  queryFn: ({ signal }) => api.listUploads(token, workspaceId, AbortSignal.any([signal, AbortSignal.timeout(10_000)])),
  refetchInterval: (query) => !query.state.error && query.state.data?.jobs.some(({ status }) => status === "queued" || status === "processing") ? 2_000 : false
});
