export type ChatPricing = { inputCostPer1kUsd: number; outputCostPer1kUsd: number };

export function estimateChatCost(pricing: ChatPricing, inputTokens: number, outputTokens: number): number {
  return (inputTokens * pricing.inputCostPer1kUsd + outputTokens * pricing.outputCostPer1kUsd) / 1_000;
}

export class ChatBudgetExceededError extends Error {
  constructor() {
    super("This request exceeds the configured AI cost budget.");
    this.name = "ChatBudgetExceededError";
  }
}
