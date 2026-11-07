import type { FaithfulnessJudge } from "../../../evaluations/index.js";
import type { AnswerGenerator } from "./answer-generator.js";
import type { ClaimVerifier } from "./claim-verifier.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import type { EmbeddingModelIdentity } from "./workspace-embedding-index.js";
import type { Reranker } from "./reranker.js";

export type ModelRuntimeIdentity = {
  // Internal registry identity. Public model aliases retain their separate allowlist.
  provider: string;
  model: string;
  inputCostPer1kUsd: number;
  outputCostPer1kUsd: number;
};

export type AnswerProviderInput = Pick<ModelRuntimeIdentity, "provider" | "model"> & { maxOutputTokens: number };

/** Factories are registered by backend composition, never by an HTTP client. */
export interface ModelProviderRegistry {
  createAnswer(input: AnswerProviderInput): AnswerGenerator;
  createEmbedding(identity: EmbeddingModelIdentity): EmbeddingProvider;
  createJudge(input: Pick<ModelRuntimeIdentity, "provider" | "model">): FaithfulnessJudge | undefined;
  createReranker(): Reranker;
}

/** The workflow runtime owns effect receipts and budgets, outside provider policy. */
export interface ModelRuntimeGuards {
  answer(inner: AnswerGenerator, input: ModelRuntimeIdentity & { checkpointKey: string; maxOutputTokens: number }): AnswerGenerator;
  judge(inner: FaithfulnessJudge, pricing: Pick<ModelRuntimeIdentity, "inputCostPer1kUsd" | "outputCostPer1kUsd">): FaithfulnessJudge;
}

export type ModelRuntimeOptions = {
  claimMode: "model" | "extractive";
  evaluationJudge?: ModelRuntimeIdentity;
};

export interface ModelRuntimeMeasurements {
  evaluationGenerator(inner: AnswerGenerator, metadata: { provider: string; model: string; inputPrice: number; outputPrice: number }): AnswerGenerator;
  judge(inner: FaithfulnessJudge, metadata: { provider: string; model: string; inputPrice: number; outputPrice: number }, operation: "evidence_judging" | "evaluation_judging"): FaithfulnessJudge;
}

/** Server-owned provider construction; no browser-supplied model or credentials. */
export interface ModelRuntimeProviders {
  createAnswer(input: ModelRuntimeIdentity & { checkpointKey: string; maxOutputTokens: number }): AnswerGenerator;
  createClaimVerifier(input?: ModelRuntimeIdentity): ClaimVerifier;
  createEvaluationJudge(): FaithfulnessJudge | undefined;
}
