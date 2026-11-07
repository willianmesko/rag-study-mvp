import type { EvaluationRun } from "../application/ports/evaluation-repository.js";
import type { WorkflowSnapshot } from "../../../platform/workflows/types.js";

export function serializeEvaluationRun(run: EvaluationRun) {
  return { ...run, createdAt: run.createdAt.toISOString() };
}

export function serializeWorkflow(run:WorkflowSnapshot) {
  return {runId:run.runId,kind:run.kind,version:run.version,status:run.status,stage:run.stage,steps:run.steps,calls:run.calls,inputTokens:run.inputTokens,outputTokens:run.outputTokens,costMicros:run.costMicros,budget:run.budget,attempts:run.attempts,errorCode:run.errorCode,resultId:run.resultId,createdAt:run.createdAt.toISOString(),updatedAt:run.updatedAt.toISOString(),expiresAt:run.expiresAt.toISOString()};
}
