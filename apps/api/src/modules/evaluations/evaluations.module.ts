import type { SearchDocumentsUseCase, DemoLibraryRepository } from "../knowledge/index.js";
import type { ChatRuntimeBindings } from "../chat/index.js";
import type { ModelRuntimeProviders } from "../ai/index.js";
import type { EvaluationRepository } from "./application/ports/evaluation-repository.js";
import type { EvaluationModels, EvaluationEmbeddingIdentityResolver, EvaluationWorkflowBinding } from "./application/ports/evaluation-workflow.js";
import { RunEvaluationUseCase } from "./application/use-cases/run-evaluation.js";

export function createEvaluationServices(dependencies: {
  evaluations: EvaluationRepository;
  searchDocuments: Pick<SearchDocumentsUseCase, "execute">;
  models: EvaluationModels;
  aiProviders: Pick<ModelRuntimeProviders, "createEvaluationJudge">;
  chatBindings: Pick<ChatRuntimeBindings, "resolveEvaluationModel">;
  embeddingIdentity: EvaluationEmbeddingIdentityResolver;
  demoLibraryRepository: Pick<DemoLibraryRepository, "sourceStates">;
  workflow: EvaluationWorkflowBinding;
}) {
  const { evaluations, searchDocuments, models, aiProviders, chatBindings, embeddingIdentity, demoLibraryRepository, workflow } = dependencies;
  const judge = aiProviders.createEvaluationJudge();
  const runEvaluation = new RunEvaluationUseCase(
    searchDocuments, evaluations, models,
    judge ? { judge, resolveModel: chatBindings.resolveEvaluationModel } : undefined,
    embeddingIdentity,
    async (tenantId) => (await demoLibraryRepository.sourceStates(tenantId, ["golden/rag-fundamentals"]))[0]?.state === "ready",
    workflow.workflow,
  );
  return {
    runEvaluation,
    listEvaluationRuns: (tenantId: string, limit: number) => evaluations.list(tenantId, limit),
    evaluationVersion: workflow.version,
  };
}
