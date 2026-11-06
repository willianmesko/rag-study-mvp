export type UsageSummary = { requests: number; cacheHits: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; averageLatencyMs: number; providerFailures: number };

export interface UsageMetricsRepository {
  record(input: { tenantId: string; actorKey: string; operation: string; provider: string; model: string; cacheHit: boolean; inputTokens: number; outputTokens: number; latencyMs: number; estimatedCostUsd: number; failed: boolean }): Promise<void>;
  summarize(input: { tenantId: string; days: number }): Promise<UsageSummary>;
}
