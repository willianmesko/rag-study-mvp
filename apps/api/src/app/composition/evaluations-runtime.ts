import { resolveWorkspaceEmbeddingIndex } from "../../modules/ai/application/ports/embedding-provider.js";
import { createEvaluationServices } from "../../modules/evaluations/evaluations.module.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { AiRuntime } from './ai-runtime.js';
import type { ChatRuntime } from './chat-runtime.js';
import type { CoreRuntime } from './core-runtime.js';
import { createEvaluationWorkflowBinding } from "./evaluation-workflow.js";
import type { KnowledgeRuntime } from './knowledge-runtime.js';
import { createPostgresEvaluationRepository } from "./postgres-persistence.js";
export function createEvaluationsRuntime(config: RuntimeConfiguration, core: CoreRuntime, ai: AiRuntime, knowledge: KnowledgeRuntime, chat: ChatRuntime) {
    const { pool, engine } = core;
    const { embeddings, modelProviders } = ai;
    const { searchDocuments, demoLibraryRepository } = knowledge;
    const { embeddingModel, defaultModel, chatBindings } = chat;
    const embeddingIdentity = async (tenantId: string) => {
        const { identity, version } = await resolveWorkspaceEmbeddingIndex(embeddings, tenantId);
        return identity ? { provider: identity.provider, model: identity.model, version } : undefined;
    };
    const evaluationDependencies = {
        searchDocuments,
        evaluations: createPostgresEvaluationRepository(pool),
        models: { embeddingProvider: config.EMBEDDING_PROVIDER, embeddingModel, chatProvider: config.CHAT_PROVIDER, chatModel: defaultModel },
        embeddingIdentity,
    };
    const { runEvaluation, listEvaluationRuns, evaluationVersion } = createEvaluationServices({
        ...evaluationDependencies,
        aiProviders: modelProviders, chatBindings, demoLibraryRepository,
        workflow: createEvaluationWorkflowBinding({ ...evaluationDependencies, durable: Boolean(engine) }),
    });
    return { embeddingIdentity, evaluationDependencies, runEvaluation, listEvaluationRuns, evaluationVersion };
}
export type EvaluationsRuntime = ReturnType<typeof createEvaluationsRuntime>;
