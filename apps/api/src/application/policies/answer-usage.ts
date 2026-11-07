import type { ChatAnswerUsage } from "@rag-study/contracts";
import type { AnswerQuestionResult } from "../ports/question-answering-workflow.js";
import { estimateChatCost, type ChatPricing } from "./chat-cost.js";
import { groundedPromptVersion } from "./grounded-answer-policy.js";

export function describeAnswerUsage(
  result: AnswerQuestionResult | null,
  pricing: ChatPricing,
  latencyMs: number,
  estimatedInputTokens: number,
  providerUsage = result?.providerUsage,
  promptVersion = groundedPromptVersion
): ChatAnswerUsage {
  const cacheHit = result?.cacheHit === true;
  const skipped = result?.refusalReason === "insufficient_context" && result.estimatedInputTokens === undefined;
  const source = cacheHit ? "cache" : skipped ? "none" : providerUsage ? "observed" : "estimated";
  const inputTokens = cacheHit || skipped ? 0 : providerUsage?.inputTokens ?? result?.estimatedInputTokens ?? estimatedInputTokens;
  const outputTokens = cacheHit || skipped ? 0 : providerUsage?.outputTokens ?? result?.estimatedOutputTokens ?? Math.ceil((result?.answer.length ?? 0) / 4);
  const safetyOutcome = !result ? "provider_failed" : cacheHit ? "cached" : result.refusalReason ? "refused" : result.structuredOutput ? "validated" : "unstructured";
  return {
    source, inputTokens, outputTokens, latencyMs: Math.max(0, Math.round(latencyMs)),
    estimatedCostUsd: estimateChatCost(pricing, inputTokens, outputTokens),
    ...(providerUsage?.costUsd !== undefined ? { observedCostUsd: providerUsage.costUsd } : {}),
    promptVersion, citationCount: result?.citedChunkIds?.length ?? 0, safetyOutcome
  };
}
