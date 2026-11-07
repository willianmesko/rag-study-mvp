// Deliberate public contracts and capabilities; concrete composition stays in the module factory.
export { evaluateContextPrecision, reviewedPassageVersion } from "./application/evaluation/context-precision.js";
export { dashboardGoldenSet, dashboardPromptInjectionSuite } from "./application/evaluation/default-evaluation-suites.js";
export { evaluationEffortSchema } from "./application/evaluation/evaluation-effort.js";
export { evaluateRetrieval } from "./application/evaluation/golden-set.js";
export { evaluatePromptInjectionSuite } from "./application/evaluation/prompt-injection-suite.js";
export { type FaithfulnessJudge, type EvaluationModel } from "./application/evaluation/public-faithfulness.js";
export { type CreateEvaluationRun, type EvaluationRun, type EvaluationRepository } from "./application/ports/evaluation-repository.js";
export { type RunEvaluationUseCase } from "./application/use-cases/run-evaluation.js";
