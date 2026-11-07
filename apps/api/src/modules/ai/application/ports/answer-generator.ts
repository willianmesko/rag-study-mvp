export type ProviderTokenUsage = { inputTokens: number; outputTokens: number; costUsd?: number };
export type ProviderUsageObserver = (usage: ProviderTokenUsage) => void;
export type AnswerControls = { extractive?:boolean; repair?:{draft:string;reason:"invalid_citations"|"unverified_claims"} };

export interface AnswerGenerator {
  readonly checkpointKey?:string;
  generate(question: string, context: string, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[], promptVariant?: ChatPromptVariantId, controls?:AnswerControls): Promise<string>;
  stream?(question: string, context: string, onDelta: (delta: string) => void | Promise<void>, signal?: AbortSignal, onUsage?: ProviderUsageObserver, previousQuestions?: readonly string[], controls?:AnswerControls): Promise<string>;
}

import type { ChatPromptVariantId } from "@rag-study/contracts";
