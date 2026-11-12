import { createModelRuntimeProviders } from "../../modules/ai/ai.module.js";
import { createWorkspaceEmbeddingAdapter, createWorkspaceEmbeddingProvider, } from "../../modules/ai/application/services/workspace-embedding-provider.js";
import { PgWorkspaceEmbeddingIndex } from "../../modules/ai/infrastructure/postgres/pg-workspace-embedding-index.js";
import { WorkflowEmbeddingProvider, WorkflowReranker } from "../../modules/ai/infrastructure/security/workflow-provider-guards.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { CoreRuntime } from './core-runtime.js';
import type { UsageRuntime } from './usage-runtime.js';
export function createAiRuntime(config: RuntimeConfiguration, core: CoreRuntime, usage: UsageRuntime) {
    const { pool, providerBindings } = core;
    const { measurements } = usage;
    const measuredEmbeddings = (identity: Parameters<typeof createWorkspaceEmbeddingAdapter>[0], tenantId?: string) => measurements.embedding(createWorkspaceEmbeddingAdapter(identity, providerBindings.registry), identity, tenantId, identity.provider === "ollama"
        ? 0
        : config.EMBEDDING_LEDGER_INPUT_COST_PER_1K_USD);
    const embeddings = new WorkflowEmbeddingProvider(createWorkspaceEmbeddingProvider(new PgWorkspaceEmbeddingIndex(pool), providerBindings.defaultEmbedding, measuredEmbeddings), "default", config.EMBEDDING_DIMENSIONS, config.EMBEDDING_INPUT_COST_PER_1K_USD);
    const rawReranker = providerBindings.registry.createReranker();
    const reranker = new WorkflowReranker(rawReranker.enabled
        ? measurements.reranker(rawReranker, {
            provider: "jina",
            model: config.JINA_RERANKER_MODEL,
            inputPrice: config.JINA_INPUT_COST_PER_1K_USD,
        })
        : rawReranker, rawReranker.enabled
        ? { billing: "paid", provider: "jina", model: config.JINA_RERANKER_MODEL, inputCostPer1kUsd: config.JINA_INPUT_COST_PER_1K_USD }
        : { billing: "local" });
    const modelProviders = createModelRuntimeProviders({
        registry: providerBindings.registry,
        guards: providerBindings.guards,
        measurements,
        options: providerBindings.options,
    });
    return { measuredEmbeddings, embeddings, rawReranker, reranker, modelProviders };
}
export type AiRuntime = ReturnType<typeof createAiRuntime>;
