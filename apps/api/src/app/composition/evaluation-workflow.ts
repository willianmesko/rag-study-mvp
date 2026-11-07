import type { SearchDocumentsUseCase } from "../../modules/knowledge/index.js";
import type { EvaluationRepository } from "../../modules/evaluations/application/ports/evaluation-repository.js";
import type { EvaluationModels, EvaluationEmbeddingIdentityResolver, EvaluationWorkflowBinding } from "../../modules/evaluations/application/ports/evaluation-workflow.js";
import { LangGraphEvaluationWorkflow, evaluationWorkflowVersion } from "../../modules/evaluations/infrastructure/langgraph/langgraph-evaluation-workflow.js";

export function createEvaluationWorkflowBinding(dependencies: {
  searchDocuments: Pick<SearchDocumentsUseCase, "execute">;
  evaluations: EvaluationRepository;
  models: EvaluationModels;
  embeddingIdentity: EvaluationEmbeddingIdentityResolver;
  durable: boolean;
}): EvaluationWorkflowBinding {
  const { searchDocuments, evaluations, models, embeddingIdentity, durable } = dependencies;
  return {
    version: evaluationWorkflowVersion,
    workflow: durable ? new LangGraphEvaluationWorkflow(searchDocuments, evaluations, models, embeddingIdentity) : undefined,
  };
}
