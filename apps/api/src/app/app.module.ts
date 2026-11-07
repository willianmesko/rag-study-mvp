import { createEvaluationServices } from "../modules/evaluations/evaluations.module.js";
import { createWorkflowRuntime, createWorkspaceWorkflowServices } from "../modules/workflows/workflows.module.js";
import { createMcpServices } from "../modules/mcp/mcp.module.js";
import { createIngestionWorkflow } from "../modules/ingestion/ingestion.module.js";
import { createUsageServices } from "../modules/usage/usage.module.js";
import { createReranker, createModelRuntimeProviders } from "../modules/ai/ai.module.js";
import { WorkflowEmbeddingProvider, WorkflowReranker } from "../modules/ai/infrastructure/security/workflow-provider-guards.js";
import { IngestDocumentUseCase } from "../modules/ingestion/application/use-cases/ingest-document.js";
import { SearchDocumentsUseCase } from "../modules/knowledge/application/use-cases/search-documents.js";
import { QueueDocumentUploadUseCase } from "../modules/ingestion/application/use-cases/queue-document-upload.js";
import { ProcessNextIngestionJobUseCase } from "../modules/ingestion/application/use-cases/process-next-ingestion-job.js";
import { RetryIngestionJobUseCase } from "../modules/ingestion/application/use-cases/retry-ingestion-job.js";
import { ReindexDocumentUseCase } from "../modules/ingestion/application/use-cases/reindex-document.js";
import { DeleteDocumentUseCase } from "../modules/knowledge/application/use-cases/delete-document.js";
import { GetDocumentOriginalUseCase } from "../modules/knowledge/application/use-cases/get-document-original.js";
import { config } from "../config.js";
import { resolveWorkspaceEmbeddingIndex } from "../modules/ai/application/ports/embedding-provider.js";
import {
  createWorkspaceEmbeddingAdapter,
  createWorkspaceEmbeddingProvider,
  defaultWorkspaceEmbeddingModel,
} from "../modules/ai/infrastructure/embedding/workspace-embedding-provider.js";
import type { DocumentFilters } from "@rag-study/contracts";
import { PgIngestionJobRepository } from "../modules/ingestion/infrastructure/postgres/pg-ingestion-job-repository.js";
import { PgQuotaRepository } from "../modules/usage/infrastructure/postgres/pg-quota-repository.js";
import { PgAuditEventRepository } from "../modules/usage/infrastructure/postgres/pg-audit-event-repository.js";
import { MultiFormatDocumentTextExtractor } from "../modules/ingestion/infrastructure/extraction/document-text-extractor.js";
import { PopplerTesseractOcr } from "../modules/ingestion/infrastructure/extraction/pdf-ocr.js";
import { HttpsPublicHtmlFetcher } from "../modules/ingestion/infrastructure/extraction/public-html-fetcher.js";
import { createPostgresPool } from "../platform/database/pool.js";
import { createIdentityServices } from "../modules/identity/identity.module.js";
import { closeApplicationResources } from "../platform/lifecycle/resources.js";
import { createWorkspacesServices } from "../modules/workspaces/workspaces.module.js";
import { createKnowledgeServices } from "../modules/knowledge/knowledge.module.js";
import { createChatStorage, createChatRuntime } from "../modules/chat/chat.module.js";

export function createApplication() {
  const identityServices = createIdentityServices({
    url: config.SUPABASE_URL,
    publishableKey: config.SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
    timeoutMs: Math.min(config.PROVIDER_TIMEOUT_MS, 10_000),
  });
  const pool = createPostgresPool(config.DATABASE_URL);
  const { budgetAlerts, usageMetrics, measurements } = createUsageServices(pool, {
    url: config.BUDGET_ALERT_WEBHOOK_URL,
    secret: config.BUDGET_ALERT_WEBHOOK_SECRET,
    thresholdUsd: config.USAGE_ALERT_THRESHOLD_USD,
    log: (record) => process.stdout.write(JSON.stringify(record) + "\n"),
  }, () => process.stdout.write('{"event":"budget_alert_enqueue","reason":"database_unavailable"}\n'));
  const { memberships, workspaceOnboarding, invitationDeliveries, inviteWorkspaceMember } = createWorkspacesServices(pool, {
    supabaseUrl: config.SUPABASE_URL,
    serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
    appBaseUrl: config.APP_BASE_URL,
  });
  const measuredEmbeddings = (
    identity: Parameters<typeof createWorkspaceEmbeddingAdapter>[0],
    tenantId?: string,
  ) =>
    measurements.embedding(
      createWorkspaceEmbeddingAdapter(identity),
      identity,
      tenantId,
      identity.provider === "ollama"
        ? 0
        : config.EMBEDDING_LEDGER_INPUT_COST_PER_1K_USD,
    );

  const mcpReadPool = config.MCP_ENABLED
    ? createPostgresPool(config.MCP_READ_DATABASE_URL ?? config.DATABASE_URL, 2)
    : null;
  const mcpServices = createMcpServices({
    pool, readPool: mcpReadPool, measuredEmbeddings,
    defaultEmbeddingIdentity: defaultWorkspaceEmbeddingModel, configuration: config,
  });
  const embeddings = new WorkflowEmbeddingProvider(
    createWorkspaceEmbeddingProvider(pool, measuredEmbeddings),
    "default",
    config.EMBEDDING_DIMENSIONS,
    config.EMBEDDING_INPUT_COST_PER_1K_USD,
  );
  const rawReranker = createReranker(config);
  const reranker = new WorkflowReranker(
    rawReranker.enabled
      ? measurements.reranker(rawReranker, {
          provider: "jina",
          model: config.JINA_RERANKER_MODEL,
          inputPrice: config.JINA_INPUT_COST_PER_1K_USD,
        })
      : rawReranker,
    rawReranker.enabled
      ? { billing: "paid", provider: "jina", model: config.JINA_RERANKER_MODEL, inputCostPer1kUsd: config.JINA_INPUT_COST_PER_1K_USD }
      : { billing: "local" },
  );
  const { documents, knowledgeStatus, demoLibraryRepository, originals } = createKnowledgeServices(pool, {
    embeddingDimensions: config.EMBEDDING_DIMENSIONS,
    supabaseUrl: config.SUPABASE_URL,
    serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
    uploadBucket: config.SUPABASE_UPLOAD_BUCKET,
  });
  const jobs = new PgIngestionJobRepository(pool);
  const quotas = new PgQuotaRepository(pool);
  const auditEvents = new PgAuditEventRepository(pool);
  const { chatRuns, conversations, semanticCache, workspaceModelPolicies } = createChatStorage(pool, config.EMBEDDING_DIMENSIONS);
  const searchDocuments = new SearchDocumentsUseCase(
    embeddings,
    documents,
    reranker,
    {
      defaultTopK: config.RETRIEVAL_TOP_K,
      vectorCandidateMultiplier: config.HYBRID_VECTOR_CANDIDATE_MULTIPLIER,
      keywordCandidateMultiplier: config.HYBRID_KEYWORD_CANDIDATE_MULTIPLIER,
      reciprocalRankConstant: config.RRF_K,
      rerankerCandidateMultiplier: config.RERANKER_CANDIDATE_MULTIPLIER,
      defaultTenantId: config.DEFAULT_TENANT_ID,
    },
  );
  const modelProviders = createModelRuntimeProviders(config, measurements);
  const { chatModels, defaultChat, compareAnswers, routeAnswer, defaultModel, embeddingModel, bindings: chatBindings } = createChatRuntime({
    embeddings, searchDocuments, semanticCache, usageMetrics, workspaceModelPolicies, chatRuns,
    quota: quotas, aiProviders: modelProviders, configuration: config,
  });
  const ingestDocument = new IngestDocumentUseCase(embeddings, documents, {
    chunkSize: config.CHUNK_SIZE,
    chunkOverlap: config.CHUNK_OVERLAP,
    embeddingConcurrency: 3,
  });
  const extractor = new MultiFormatDocumentTextExtractor({
    ocr: config.PDF_OCR_ENABLED
      ? new PopplerTesseractOcr({
          languages: config.PDF_OCR_LANGUAGES,
          timeoutMs: config.PDF_OCR_TIMEOUT_MS,
        })
      : undefined,
    maxOcrPages: config.PDF_OCR_MAX_PAGES,
  });
  const engine = createWorkflowRuntime(pool, config, (code) => console.error(JSON.stringify({ event: "workflow_failure", reason: code })));
  const embeddingIdentity = async (tenantId: string) => {
    const { identity, version } = await resolveWorkspaceEmbeddingIndex(embeddings, tenantId);
    return identity ? { provider: identity.provider, model: identity.model, version } : undefined;
  };
  const { runEvaluation, listEvaluationRuns, evaluationVersion } = createEvaluationServices({
    pool, searchDocuments,
    models: { embeddingProvider: config.EMBEDDING_PROVIDER, embeddingModel, chatProvider: config.CHAT_PROVIDER, chatModel: defaultModel },
    aiProviders: modelProviders, chatBindings, embeddingIdentity, demoLibraryRepository, durable: Boolean(engine),
  });
  const embeddingVersion = async (tenantId: string) =>
    (await resolveWorkspaceEmbeddingIndex(embeddings, tenantId)).version ??
    "legacy-default";
  const workflows = createWorkspaceWorkflowServices({
    engine, chat: chatBindings, runEvaluation, evaluationVersion,
    member: memberships.findByUserAndTenant.bind(memberships), embeddingVersion, configuration: config,
  });
  const enqueueIngestion = createIngestionWorkflow({
    jobs, extractor, ingestDocument, originals, semanticCache,
    engine, embeddingVersion, configuration: config,
  });
  return {
    useCases: {
      ...identityServices,
      ingestDocument,
      demoLibraryRepository,
      queueDocumentUpload: new QueueDocumentUploadUseCase(
        jobs,
        originals,
        config.DAILY_ADMIN_UPLOAD_BYTES_LIMIT,
      ),
      publicHtmlFetcher: new HttpsPublicHtmlFetcher({
        maxBytes: Math.min(config.UPLOAD_MAX_BYTES, 1_000_000),
        timeoutMs: 10_000,
      }),
      processNextIngestionJob: new ProcessNextIngestionJobUseCase(
        jobs,
        extractor,
        ingestDocument,
        originals,
        semanticCache,
        enqueueIngestion,
      ),
      retryIngestionJob: new RetryIngestionJobUseCase(jobs),
      listIngestionJobs: (tenantId: string, limit: number) =>
        jobs.list(tenantId, limit),
      listIngestionEvents: (jobId: string, tenantId: string, limit: number) =>
        jobs.listEvents(jobId, tenantId, limit),
      previewIngestionPassages: jobs.previewPassages.bind(jobs),
      listMemberships: memberships.listByUserId.bind(memberships),
      findMembership: memberships.findByUserAndTenant.bind(memberships),
      createWorkspace: memberships.createWorkspace.bind(memberships),
      listWorkspaceMembers: memberships.listMembers.bind(memberships),
      addWorkspaceMember: memberships.addMember.bind(memberships),
      changeWorkspaceMemberRole: memberships.changeMemberRole.bind(memberships),
      removeWorkspaceMember: memberships.removeMember.bind(memberships),
      recordWorkspaceInvitation: memberships.recordInvitation.bind(memberships),
      listDocuments: (
        tenantId: string,
        limit: number,
        filters?: DocumentFilters,
      ) => documents.list(tenantId, limit, filters),
      knowledgeStatus,
      listDocumentChunks: (
        tenantId: string,
        documentId: string,
        limit: number,
      ) => documents.listChunks({ tenantId, documentId, limit }),
      getDocumentOriginal: new GetDocumentOriginalUseCase(jobs, originals),
      reindexDocument: new ReindexDocumentUseCase(jobs),
      deleteDocument: new DeleteDocumentUseCase(documents, jobs, originals),
      consumeQuestionQuota: (
        tenantId: string,
        actorKey: string,
        units?: 1 | 2,
        receiptKey?: string,
      ) =>
        quotas.consumeQuestion({
          tenantId,
          actorKey,
          units,
          receiptKey,
          tenantLimit: config.DAILY_TENANT_QA_LIMIT,
          actorLimit: config.DAILY_USER_QA_LIMIT,
        }),
      consumeAdminUploadQuota: (
        tenantId: string,
        actorKey: string,
        bytes: number,
      ) =>
        quotas.consumeUpload({
          tenantId,
          actorKey,
          bytes,
          limit: config.DAILY_ADMIN_UPLOAD_BYTES_LIMIT,
        }),
      getUsageSummary: (tenantId: string, days: number) =>
        usageMetrics.summarize({ tenantId, days }),
      listEvaluationRuns,
      runEvaluation,
      invalidateSemanticCache: (tenantId: string) =>
        semanticCache.invalidateTenant(tenantId),
      recordAuditEvent: auditEvents.record.bind(auditEvents),
      budgetAlerts,
      inviteWorkspaceMember,
      listInvitationDeliveries:
        invitationDeliveries.list.bind(invitationDeliveries),
      pruneInvitationDeliveries:
        invitationDeliveries.prune.bind(invitationDeliveries),
      searchDocuments,
      chatRuns,
      conversations,
      workflows,
      cancelIngestion: async (tenantId: string, jobId: string) => {
        const changed = await jobs.cancel(jobId, tenantId);
        if (changed)
          await engine?.cancel({
            tenantId,
            actorId: "ingestion",
            runId: jobId,
          });
        return changed;
      },
      workspaceOnboarding,
      chatModels,
      workspaceModelPolicies,
      ...mcpServices,
      compareAnswers,
      routeAnswer,
      answerQuestion: defaultChat.answerQuestion,
    },
    close: () => closeApplicationResources({ workflows, pool, mcpReadPool }),
  };
}
