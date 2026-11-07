import { z } from "zod";

const count = z.number().int().nonnegative();
const amount = z.number().finite().nonnegative();
export const usageTotalsSchema = z.object({
  requests: count,
  cacheHits: count,
  inputTokens: count,
  outputTokens: count,
  estimatedCostUsd: amount,
  averageLatencyMs: amount,
  providerFailures: count,
  observedRequests: count.default(0),
  observedCostUsd: amount.default(0),
  effectiveCostUsd: amount.optional(),
  estimatedOnlyCostUsd: amount.optional(),
  observedCostRequests: count.default(0),
  estimatedCostRequests: count.default(0),
  skippedRequests: count.default(0),
  observedInputTokens: count.default(0),
  observedOutputTokens: count.default(0),
  estimatedInputTokens: count.default(0),
  estimatedOutputTokens: count.default(0),
  unpricedRequests:count.optional(),
  p95LatencyMs: amount.default(0),
});
export const usageModelSchema = usageTotalsSchema.extend({
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
});
export const usageOperationSchema = usageTotalsSchema.extend({
  operation: z.string().min(1).max(100),
});
export const usageDaySchema = usageTotalsSchema.extend({ date: z.iso.date() });
export const usageSummarySchema = usageTotalsSchema.extend({
  models: z.array(usageModelSchema).default([]),
  operations: z.array(usageOperationSchema).default([]),
  daily: z.array(usageDaySchema).default([]),
  extendedSince:z.iso.datetime().optional(),
  windowStart: z.iso.datetime().optional(),
  windowEnd: z.iso.datetime().optional(),
});
export const usageResponseSchema = z.object({
  days: z.number().int().min(1).max(90),
  summary: usageSummarySchema,
  alert: z.object({ thresholdUsd: amount, triggered: z.boolean() }),
});
export type UsageTotals = z.output<typeof usageTotalsSchema>;
export type UsageModel = z.output<typeof usageModelSchema>;
export type UsageSummary = z.output<typeof usageSummarySchema>;
export type UsageSummaryInput = z.input<typeof usageSummarySchema>;
export type UsageResponse = z.output<typeof usageResponseSchema>;
