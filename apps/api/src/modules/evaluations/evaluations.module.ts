import type { Pool } from "pg";
import type { SearchDocumentsUseCase, DemoLibraryRepository } from "../knowledge/index.js";
import type { ChatRuntimeBindings } from "../chat/index.js";
import type { ModelRuntimeProviders } from "../ai/index.js";
import { RunEvaluationUseCase } from "./application/use-cases/run-evaluation.js";
import { PgEvaluationRepository } from "./infrastructure/postgres/pg-evaluation-repository.js";
import { LangGraphEvaluationWorkflow, evaluationWorkflowVersion } from "./infrastructure/langgraph/langgraph-evaluation-workflow.js";

export function createEvaluationServices(dependencies: {
  pool: Pool;
  searchDocuments: SearchDocumentsUseCase;
  models: { embeddingProvider: string; embeddingModel: string; chatProvider: string; chatModel: string };
  aiProviders: Pick<ModelRuntimeProviders, "createEvaluationJudge">;
  chatBindings: Pick<ChatRuntimeBindings, "resolveEvaluationModel">;
  embeddingIdentity: NonNullable<ConstructorParameters<typeof RunEvaluationUseCase>[4]>;
  demoLibraryRepository: Pick<DemoLibraryRepository, "sourceStates">;
  durable: boolean;
}) {
  const { pool, searchDocuments, models, aiProviders, chatBindings, embeddingIdentity, demoLibraryRepository, durable } = dependencies;
  const evaluations = new PgEvaluationRepository(pool);
  const judge = aiProviders.createEvaluationJudge();
  const runEvaluation = new RunEvaluationUseCase(
    searchDocuments, evaluations, models,
    judge ? { judge, resolveModel: chatBindings.resolveEvaluationModel } : undefined,
    embeddingIdentity,
    async (tenantId) => (await demoLibraryRepository.sourceStates(tenantId, ["golden/rag-fundamentals"]))[0]?.state === "ready",
    durable ? new LangGraphEvaluationWorkflow(searchDocuments, evaluations, models, embeddingIdentity) : undefined,
  );
  return {
    runEvaluation,
    listEvaluationRuns: (tenantId: string, limit: number) => evaluations.list(tenantId, limit),
    evaluationVersion: evaluationWorkflowVersion,
  };
}
