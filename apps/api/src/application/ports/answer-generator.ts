export type ProviderTokenUsage = { inputTokens: number; outputTokens: number; costUsd?: number };
export type ProviderUsageObserver = (usage: ProviderTokenUsage) => void;

export interface AnswerGenerator {
  generate(question: string, context: string, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[]): Promise<string>;
  stream?(question: string, context: string, onDelta: (delta: string) => void | Promise<void>, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[]): Promise<string>;
}

