import { AnswerQuestionUseCase } from "./application/use-cases/answer-question.js";
import { IngestDocumentUseCase } from "./application/use-cases/ingest-document.js";
import { SearchDocumentsUseCase } from "./application/use-cases/search-documents.js";
import { QueueDocumentUploadUseCase } from "./application/use-cases/queue-document-upload.js";
import { ProcessNextIngestionJobUseCase } from "./application/use-cases/process-next-ingestion-job.js";
import { RetryIngestionJobUseCase } from "./application/use-cases/retry-ingestion-job.js";
import { ReindexDocumentUseCase } from "./application/use-cases/reindex-document.js";
import { DeleteDocumentUseCase } from "./application/use-cases/delete-document.js";
import { config } from "./config.js";
import type { AnswerGenerator } from "./application/ports/answer-generator.js";
import type { EmbeddingProvider } from "./application/ports/embedding-provider.js";
import type { Reranker } from "./application/ports/reranker.js";
import { BedrockAnswerGenerator } from "./infrastructure/bedrock/bedrock-answer-generator.js";
import { createBedrockClient } from "./infrastructure/bedrock/client.js";
import { TitanEmbeddingProvider } from "./infrastructure/bedrock/titan-embedding-provider.js";
import { LangGraphRagWorkflow } from "./infrastructure/langgraph/langgraph-rag-workflow.js";
import { LangSmithTracingWorkflow } from "./infrastructure/langsmith/langsmith-tracing-workflow.js";
import { JinaReranker } from "./infrastructure/jina/jina-reranker.js";
import { OllamaAnswerGenerator } from "./infrastructure/ollama/ollama-answer-generator.js";
import { OllamaEmbeddingProvider } from "./infrastructure/ollama/ollama-embedding-provider.js";
import { OpenRouterAnswerGenerator } from "./infrastructure/openrouter/openrouter-answer-generator.js";
import { OpenRouterEmbeddingProvider } from "./infrastructure/openrouter/openrouter-embedding-provider.js";
import { PgDocumentRepository } from "./infrastructure/postgres/pg-document-repository.js";
import { PgIngestionJobRepository } from "./infrastructure/postgres/pg-ingestion-job-repository.js";
import { PgQuotaRepository } from "./infrastructure/postgres/pg-quota-repository.js";
import { PgAuditEventRepository } from "./infrastructure/postgres/pg-audit-event-repository.js";
import { MultiFormatDocumentTextExtractor } from "./infrastructure/ingestion/document-text-extractor.js";
import { createPostgresPool } from "./infrastructure/postgres/pool.js";
import { PassThroughReranker } from "./infrastructure/reranking/pass-through-reranker.js";
import { SupabaseOriginalFileStore } from "./infrastructure/storage/supabase-original-file-store.js";

export function createApplication() {
  const pool = createPostgresPool(config.DATABASE_URL);
  const embeddings = createEmbeddingProvider();
  const answerGenerator = createAnswerGenerator();
  const reranker = createReranker();
  const documents = new PgDocumentRepository(pool, config.EMBEDDING_DIMENSIONS);
  const jobs = new PgIngestionJobRepository(pool);
  const quotas = new PgQuotaRepository(pool);
  const auditEvents = new PgAuditEventRepository(pool);
  const originals = new SupabaseOriginalFileStore(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
    config.SUPABASE_UPLOAD_BUCKET
  );
  const searchDocuments = new SearchDocumentsUseCase(embeddings, documents, reranker, {
    defaultTopK: config.RETRIEVAL_TOP_K,
    vectorCandidateMultiplier: config.HYBRID_VECTOR_CANDIDATE_MULTIPLIER,
    keywordCandidateMultiplier: config.HYBRID_KEYWORD_CANDIDATE_MULTIPLIER,
    reciprocalRankConstant: config.RRF_K,
    rerankerCandidateMultiplier: config.RERANKER_CANDIDATE_MULTIPLIER,
    defaultTenantId: config.DEFAULT_TENANT_ID
  });
  const ragWorkflow = new LangGraphRagWorkflow(searchDocuments, answerGenerator, {
    maxContextChars: 12_000,
    minimumScore: config.RAG_MINIMUM_SCORE
  });
  const answerWorkflow = new LangSmithTracingWorkflow(ragWorkflow, {
    enabled: config.LANGSMITH_TRACING,
    projectName: config.LANGSMITH_PROJECT
  });

  const ingestDocument = new IngestDocumentUseCase(embeddings, documents, {
    chunkSize: config.CHUNK_SIZE,
    chunkOverlap: config.CHUNK_OVERLAP,
    embeddingConcurrency: 3
  });
  return {
    useCases: {
      ingestDocument,
      queueDocumentUpload: new QueueDocumentUploadUseCase(jobs, originals),
      processNextIngestionJob: new ProcessNextIngestionJobUseCase(jobs, new MultiFormatDocumentTextExtractor(), ingestDocument, originals),
      retryIngestionJob: new RetryIngestionJobUseCase(jobs),
      listIngestionJobs: (tenantId: string, limit: number) => jobs.list(tenantId, limit),
      listDocuments: (tenantId: string, limit: number) => documents.list(tenantId, limit),
      listDocumentChunks: (tenantId: string, documentId: string, limit: number) => documents.listChunks({ tenantId, documentId, limit }),
      reindexDocument: new ReindexDocumentUseCase(jobs),
      deleteDocument: new DeleteDocumentUseCase(documents, jobs, originals),
      consumeQuestionQuota: (tenantId: string, actorKey: string) => quotas.consumeQuestion({ tenantId, actorKey, limit: config.DAILY_TENANT_QA_LIMIT }),
      consumeAdminUploadQuota: (tenantId: string, actorKey: string, bytes: number) => quotas.consumeUpload({ tenantId, actorKey, bytes, limit: config.DAILY_ADMIN_UPLOAD_BYTES_LIMIT }),
      recordAuditEvent: auditEvents.record.bind(auditEvents),
      searchDocuments,
      answerQuestion: new AnswerQuestionUseCase(answerWorkflow)
    },
    close: () => pool.end()
  };
}

function createReranker(): Reranker {
  if (config.RERANKER_PROVIDER === "jina") {
    return new JinaReranker(
      config.JINA_BASE_URL,
      config.JINA_API_KEY as string,
      config.JINA_RERANKER_MODEL
    );
  }
  return new PassThroughReranker();
}

function createEmbeddingProvider(): EmbeddingProvider {
  switch (config.EMBEDDING_PROVIDER) {
    case "ollama":
      return new OllamaEmbeddingProvider(
        config.OLLAMA_BASE_URL,
        config.OLLAMA_EMBEDDING_MODEL,
        config.EMBEDDING_DIMENSIONS
      );
    case "openrouter":
      return new OpenRouterEmbeddingProvider(
        config.OPENROUTER_BASE_URL,
        config.OPENROUTER_API_KEY as string,
        config.OPENROUTER_EMBEDDING_MODEL,
        config.EMBEDDING_DIMENSIONS
      );
    case "bedrock": {
      const bedrock = createBedrockClient(config.AWS_REGION);
      return new TitanEmbeddingProvider(bedrock, config.BEDROCK_EMBEDDING_MODEL_ID, config.EMBEDDING_DIMENSIONS);
    }
  }
}

function createAnswerGenerator(): AnswerGenerator {
  switch (config.CHAT_PROVIDER) {
    case "ollama":
      return new OllamaAnswerGenerator(config.OLLAMA_BASE_URL, config.OLLAMA_CHAT_MODEL);
    case "openrouter":
      return new OpenRouterAnswerGenerator(
        config.OPENROUTER_BASE_URL,
        config.OPENROUTER_API_KEY as string,
        config.OPENROUTER_CHAT_MODEL
      );
    case "bedrock": {
      const bedrock = createBedrockClient(config.AWS_REGION);
      return new BedrockAnswerGenerator(bedrock, config.BEDROCK_CHAT_MODEL_ID);
    }
  }
}

