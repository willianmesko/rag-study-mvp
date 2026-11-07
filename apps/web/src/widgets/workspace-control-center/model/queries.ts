import { queryOptions } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import type { DocumentFilters } from "@rag-study/contracts";
import { privateQueryKey } from "../../../shared/lib/query-keys";

export const documentsQuery = (token: string, workspaceId: string, userId: string | null, filters: DocumentFilters = {}) => queryOptions({
  queryKey: Object.values(filters).some((value) => value !== undefined) ? privateQueryKey("documents", userId, workspaceId, filters) : privateQueryKey("documents", userId, workspaceId),
  queryFn: ({ signal }) => api.listDocuments(token, workspaceId, AbortSignal.any([signal, AbortSignal.timeout(10_000)]), filters),
  refetchInterval: 5_000
});

export const ingestionJobsQuery = (token: string, workspaceId: string, userId: string | null) => queryOptions({
  queryKey: privateQueryKey("ingestion-jobs", userId, workspaceId),
  queryFn: ({ signal }) => api.listUploads(token, workspaceId, signal),
  refetchInterval: 3_000
});

export { usageQuery } from "../../../entities/workspace/index";

export const evaluationsQuery = (token: string, workspaceId: string, userId: string | null) => queryOptions({
  queryKey: privateQueryKey("evaluation-runs", userId, workspaceId),
  queryFn: ({ signal }) => api.listEvaluationRuns(token, workspaceId, signal),
  refetchInterval: (query) => ["queued", "processing"].includes(query.state.data?.reference?.state ?? "") || query.state.data?.workflows?.some((run) => ["queued","running","waiting_approval"].includes(run.status)) ? 3_000 : false
});

export { membersQuery } from "../../../entities/workspace/index";
