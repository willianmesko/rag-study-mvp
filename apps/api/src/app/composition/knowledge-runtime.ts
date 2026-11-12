import { createKnowledgeServices } from "../../modules/knowledge/knowledge.module.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { AiRuntime } from './ai-runtime.js';
import type { CoreRuntime } from './core-runtime.js';
import { createPostgresKnowledgeBindings } from "./postgres-persistence.js";
export function createKnowledgeRuntime(config: RuntimeConfiguration, core: CoreRuntime, ai: AiRuntime) {
    const { pool, originals, jobs } = core;
    const { embeddings, reranker } = ai;
    const { documents, knowledgeStatus, demoLibraryRepository, searchDocuments, getDocumentOriginal, deleteDocument } = createKnowledgeServices({
        ...createPostgresKnowledgeBindings(pool, config.EMBEDDING_DIMENSIONS),
        originals, embeddings, reranker, sourceJobs: jobs,
        searchOptions: {
            defaultTopK: config.RETRIEVAL_TOP_K,
            vectorCandidateMultiplier: config.HYBRID_VECTOR_CANDIDATE_MULTIPLIER,
            keywordCandidateMultiplier: config.HYBRID_KEYWORD_CANDIDATE_MULTIPLIER,
            reciprocalRankConstant: config.RRF_K,
            rerankerCandidateMultiplier: config.RERANKER_CANDIDATE_MULTIPLIER,
            defaultTenantId: config.DEFAULT_TENANT_ID,
        },
    });
    return { documents, knowledgeStatus, demoLibraryRepository, searchDocuments, getDocumentOriginal, deleteDocument };
}
export type KnowledgeRuntime = ReturnType<typeof createKnowledgeRuntime>;
