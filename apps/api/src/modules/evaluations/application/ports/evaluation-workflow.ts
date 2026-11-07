import type { EvaluationEffort } from "../evaluation/evaluation-effort.js";
import type {
  EvaluationModel,
  FaithfulnessJudge,
} from "../evaluation/public-faithfulness.js";
import type { EvaluationRun } from "./evaluation-repository.js";
import type { EvaluationEmbeddingIdentity } from "../evaluation/retrieve-reference-cases.js";

export type EvaluationModels = {
  embeddingProvider: string;
  embeddingModel: string;
  chatProvider: string;
  chatModel: string;
};
export type EvaluationEmbeddingIdentityResolver = (
  tenantId: string,
) => Promise<EvaluationEmbeddingIdentity | undefined>;

export interface EvaluationWorkflow {
  execute(input: {
    tenantId: string;
    effort: EvaluationEffort;
    model?: EvaluationModel;
    judge?: FaithfulnessJudge;
    signal?: AbortSignal;
  }): Promise<EvaluationRun>;
}

export type EvaluationWorkflowBinding = {
  version: string;
  workflow?: EvaluationWorkflow;
};
