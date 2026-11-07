import { queryOptions } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import { privateQueryKey } from "../../../shared/lib/query-keys";

export const knowledgeStatusQuery = (token?: string | null, workspaceId?: string, userId?: string | null) => queryOptions({
  queryKey: token ? privateQueryKey("knowledge-status", userId, workspaceId) : ["knowledge-status", "public-demo"],
  queryFn: ({ signal }) => api.knowledgeStatus(token, workspaceId, AbortSignal.any([signal, AbortSignal.timeout(10_000)])),
  enabled: !token || Boolean(workspaceId && userId),
  retry: false,
  staleTime: 3_000,
  refetchOnMount: "always",
  refetchInterval: (query) => query.state.status === "error" ? false
    : query.state.data?.processingJobs || !query.state.data?.passages ? 3_000 : 15_000
});
