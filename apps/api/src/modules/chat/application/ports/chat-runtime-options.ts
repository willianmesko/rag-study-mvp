import type { ChatModelDescriptor } from "@rag-study/contracts";

type ChatModelConfiguration = {
  id: string;
  label: string;
  provider?: ChatModelDescriptor["provider"];
  model: string;
  inputCostPer1kUsd: number;
  outputCostPer1kUsd: number;
};

export type ChatRuntimeOptions = {
  defaultModel: Omit<ChatModelConfiguration, "id" | "label" | "provider"> & {
    label?: string;
    provider: ChatModelDescriptor["provider"];
  };
  additionalModels: readonly ChatModelConfiguration[];
  embeddingIdentity: { provider: string; model: string };
  rerankerIdentity: { provider: string; model?: string };
  claimMode: "model" | "extractive";
  minimumScore: number;
  maxSteps: number;
  timeoutMs: number;
  requireStructuredOutput: boolean;
  retrievalTopK: number;
  maxOutputTokens: number;
  maxEstimatedCostUsd: number;
  autoMaxTotalInputTokens: number;
  autoMaxTotalOutputTokens?: number;
  cacheTtlSeconds: number;
  cacheMinimumSimilarity: number;
  tenantDailyQuestionLimit: number;
  userDailyQuestionLimit: number;
};
