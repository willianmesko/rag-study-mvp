import { queryOptions } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";
import { privateQueryKey } from "../../../shared/lib/query-keys";

export const usageQuery = (token: string, workspaceId: string, userId: string | null, days = 30) =>
  queryOptions({
    queryKey: privateQueryKey("usage-summary", userId, workspaceId, days),
    queryFn: ({ signal }) => api.getUsageSummary(token, workspaceId, days, signal),
    retry: false,
    refetchInterval: (query) => query.state.status === "error" ? false : 30_000,
  });
