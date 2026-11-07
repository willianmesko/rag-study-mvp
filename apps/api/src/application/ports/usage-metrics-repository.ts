import type { ChatAnswerUsage, UsageSummaryInput } from "@rag-study/contracts";

export type UsageSummary = UsageSummaryInput;

export interface UsageMetricsRepository {
  record(input: { tenantId: string; actorKey: string; operation: string; provider: string; model: string; cacheHit: boolean; inputTokens: number; outputTokens: number; latencyMs: number; estimatedCostUsd: number; failed: boolean } & Partial<Pick<ChatAnswerUsage, "source" | "observedCostUsd" | "promptVersion" | "citationCount" | "safetyOutcome">>): Promise<void>;
  summarize(input: { tenantId: string; days: number }): Promise<UsageSummary>;
}
