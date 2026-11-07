import { queryOptions } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import type { DocumentFilters } from "@rag-study/contracts";
import { privateQueryKey } from "../../../shared/lib/query-keys";

export const documentsQuery = (token: string, workspaceId: string, userId: string | null, filters: DocumentFilters = {}) => queryOptions({
  queryKey: Object.values(filters).some((value) => value !== undefined) ? privateQueryKey("documents", userId, workspaceId, filters) : privateQueryKey("documents", userId, workspaceId),
  queryFn: ({ signal }) => api.listDocuments(token, workspaceId, signal, filters),
  retry: false,
  refetchOnWindowFocus: "always",
  refetchOnReconnect: "always"
});

export const ingestionJobsQuery = (token: string, workspaceId: string, userId: string | null) => queryOptions({
  queryKey: privateQueryKey("ingestion-jobs", userId, workspaceId),
  queryFn: ({ signal }) => api.listUploads(token, workspaceId, signal),
  retry: false,
  staleTime: 3_000,
  refetchOnWindowFocus: "always",
  refetchOnReconnect: "always"
});

export { usageQuery } from "../../../entities/workspace/index";

export const evaluationsQuery = (token: string, workspaceId: string, userId: string | null) => queryOptions({
  queryKey: privateQueryKey("evaluation-runs", userId, workspaceId),
  queryFn: ({ signal }) => api.listEvaluationRuns(token, workspaceId, signal),
  retry: false,
  refetchOnWindowFocus: "always",
  refetchOnReconnect: "always",
  refetchInterval: (query) => query.state.status !== "error" && (["queued", "processing"].includes(query.state.data?.reference?.state ?? "") || query.state.data?.workflows?.some((run) => ["queued","running"].includes(run.status))) ? 3_000 : false
});

export { membersQuery } from "../../../entities/workspace/index";
