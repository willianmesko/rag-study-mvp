import { queryOptions } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import type { DocumentFilters } from "@rag-study/contracts";

export const documentsQuery = (token: string, workspaceId: string, filters: DocumentFilters = {}) => queryOptions({
  queryKey: Object.values(filters).some((value) => value !== undefined) ? ["documents", token, workspaceId, filters] : ["documents", token, workspaceId],
  queryFn: ({ signal }) => api.listDocuments(token, workspaceId, AbortSignal.any([signal, AbortSignal.timeout(10_000)]), filters),
  refetchInterval: 5_000
});

export const ingestionJobsQuery = (token: string, workspaceId: string) => queryOptions({
  queryKey: ["ingestion-jobs", token, workspaceId],
  queryFn: () => api.listUploads(token, workspaceId),
  refetchInterval: 3_000
});

export const usageQuery = (token: string, workspaceId: string) => queryOptions({
  queryKey: ["usage-summary", token, workspaceId],
  queryFn: () => api.getUsageSummary(token, workspaceId),
  refetchInterval: 30_000
});

export const evaluationsQuery = (token: string, workspaceId: string) => queryOptions({
  queryKey: ["evaluation-runs", token, workspaceId],
  queryFn: () => api.listEvaluationRuns(token, workspaceId),
  refetchInterval: (query) => ["queued", "processing"].includes(query.state.data?.reference?.state ?? "") || query.state.data?.workflows?.some((run) => ["queued","running","waiting_approval"].includes(run.status)) ? 3_000 : false
});

export { membersQuery } from "../../../entities/workspace/model/members";
