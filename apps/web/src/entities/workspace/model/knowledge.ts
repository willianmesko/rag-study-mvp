import { queryOptions } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import { privateQueryKey } from "../../../shared/lib/query-keys";

export const knowledgeStatusQuery = (token?: string | null, workspaceId?: string, userId?: string | null) => queryOptions({
  queryKey: token ? privateQueryKey("knowledge-status", userId, workspaceId) : ["knowledge-status", "public-demo"],
  queryFn: ({ signal }) => api.knowledgeStatus(token, workspaceId, signal),
  enabled: !token || Boolean(workspaceId && userId),
  retry: false,
  staleTime: 3_000,
  refetchOnMount: "always",
  refetchOnWindowFocus: "always",
  refetchOnReconnect: "always",
  refetchInterval: (query) => query.state.status === "error" ? false
    : query.state.data?.processingJobs ? 3_000 : 30_000
});
