import { queryOptions } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";

export const documentsQuery = (token: string, workspaceId: string) => queryOptions({
  queryKey: ["documents", token, workspaceId],
  queryFn: () => api.listDocuments(token, workspaceId),
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
  queryFn: () => api.listEvaluationRuns(token, workspaceId)
});

export const membersQuery = (token: string, workspaceId: string) => queryOptions({
  queryKey: ["workspace-members", token, workspaceId],
  queryFn: () => api.listWorkspaceMembers(workspaceId, token)
});
