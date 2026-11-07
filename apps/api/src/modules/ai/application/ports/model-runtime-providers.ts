import type { ChatModelDescriptor } from "@rag-study/contracts";
import type { FaithfulnessJudge } from "../../../evaluations/index.js";
import type { AnswerGenerator } from "./answer-generator.js";
import type { ClaimVerifier } from "./claim-verifier.js";

export type ModelRuntimeIdentity = {
  provider: ChatModelDescriptor["provider"];
  model: string;
  inputCostPer1kUsd: number;
  outputCostPer1kUsd: number;
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
