import { queryOptions } from "@tanstack/react-query";
import { api } from "../../../shared/api/rag-api";

export const usageQuery = (token: string, workspaceId: string, days = 30) =>
  queryOptions({
    queryKey: ["usage-summary", token, workspaceId, days],
    queryFn: () => api.getUsageSummary(token, workspaceId, days),
    refetchInterval: 30_000,
  });
