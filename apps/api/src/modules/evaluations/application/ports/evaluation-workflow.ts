import type { EvaluationEffort } from "../evaluation/evaluation-effort.js";
import type {
  EvaluationModel,
  FaithfulnessJudge,
} from "../evaluation/public-faithfulness.js";
import type { EvaluationRun } from "./evaluation-repository.js";
export interface EvaluationWorkflow {
  execute(input: {
    tenantId: string;
    effort: EvaluationEffort;
    model?: EvaluationModel;
    judge?: FaithfulnessJudge;
    signal?: AbortSignal;
  }): Promise<EvaluationRun>;
}
