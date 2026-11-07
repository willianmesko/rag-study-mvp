import { createEvaluationServices } from "../modules/evaluations/evaluations.module.js";
import { createWorkspaceWorkflowServices } from "../modules/workflows/workflows.module.js";
import { createMcpServices } from "../modules/mcp/mcp.module.js";
import { createIngestionWorkflow } from "../modules/ingestion/ingestion.module.js";
import { createUsageServices } from "../modules/usage/usage.module.js";
import { createModelRuntimeProviders } from "../modules/ai/ai.module.js";
import { WorkflowEmbeddingProvider, WorkflowReranker } from "../modules/ai/infrastructure/security/workflow-provider-guards.js";
import { IngestDocumentUseCase } from "../modules/ingestion/application/use-cases/ingest-document.js";
import { QueueDocumentUploadUseCase } from "../modules/ingestion/application/use-cases/queue-document-upload.js";
import { ProcessNextIngestionJobUseCase } from "../modules/ingestion/application/use-cases/process-next-ingestion-job.js";
import { RetryIngestionJobUseCase } from "../modules/ingestion/application/use-cases/retry-ingestion-job.js";
import { ReindexDocumentUseCase } from "../modules/ingestion/application/use-cases/reindex-document.js";
import type { RuntimeConfiguration } from "./configuration/environment.js";
import { resolveWorkspaceEmbeddingIndex } from "../modules/ai/application/ports/embedding-provider.js";
import {
  createWorkspaceEmbeddingAdapter,
  createWorkspaceEmbeddingProvider,
} from "../modules/ai/application/services/workspace-embedding-provider.js";
import { PgWorkspaceEmbeddingIndex } from "../modules/ai/infrastructure/postgres/pg-workspace-embedding-index.js";
import type { DocumentFilters } from "@rag-study/contracts";
import { PgIngestionJobRepository } from "../modules/ingestion/infrastructure/postgres/pg-ingestion-job-repository.js";
import { MultiFormatDocumentTextExtractor } from "../modules/ingestion/infrastructure/extraction/document-text-extractor.js";
import { PopplerTesseractOcr } from "../modules/ingestion/infrastructure/extraction/pdf-ocr.js";
import { HttpsPublicHtmlFetcher } from "../modules/ingestion/infrastructure/extraction/public-html-fetcher.js";
import { createPostgresPool } from "../platform/database/pool.js";
import { createIdentityServices } from "./composition/identity.js";
import { closeApplicationResources } from "../platform/lifecycle/resources.js";
import { createWorkspacesServices } from "../modules/workspaces/workspaces.module.js";
import { createKnowledgeServices } from "../modules/knowledge/knowledge.module.js";
import { createChatRuntime } from "../modules/chat/chat.module.js";
import { createChatStorage } from "./composition/chat-storage.js";
import { createConfiguredProviderBindings } from "./composition/provider-registry.js";
import { chatRuntimeOptionsFromConfiguration, createChatWorkflowBindings } from "./composition/chat-workflows.js";
import { createEvaluationWorkflowBinding } from "./composition/evaluation-workflow.js";
import { createIngestionWorkflowAdapter, ingestionWorkflowOptionsFromConfiguration } from "./composition/ingestion-workflow.js";
import { createWorkflowRuntime, workspaceWorkflowOptionsFromConfiguration } from "./composition/workflow-runtime.js";
import { createPostgresAccessBindings, createPostgresEvaluationRepository, createPostgresKnowledgeBindings, createPostgresMcpBindings, createPostgresUsageBindings, createPostgresWorkspaceBindings } from "./composition/postgres-persistence.js";
import { createSupabaseInvitationGateway, createSupabaseOriginalFileStore } from "./composition/supabase-bindings.js";

export function createApplication(config: RuntimeConfiguration) {
  const identityServices = createIdentityServices({
    url: config.SUPABASE_URL,
    publishableKey: config.SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
    timeoutMs: Math.min(config.PROVIDER_TIMEOUT_MS, 10_000),
  });
  const pool = createPostgresPool(config.DATABASE_URL);
  const usageBindings = createPostgresUsageBindings(pool, {
    url: config.BUDGET_ALERT_WEBHOOK_URL,
    secret: config.BUDGET_ALERT_WEBHOOK_SECRET,
    thresholdUsd: config.USAGE_ALERT_THRESHOLD_USD,
    log: (record) => process.stdout.write(JSON.stringify(record) + "\n"),
  });
  const { budgetAlerts, usageMetrics, measurements } = createUsageServices({
    ...usageBindings,
    reportEnqueueFailure: () => process.stdout.write('{"event":"budget_alert_enqueue","reason":"database_unavailable"}\n'),
  });
  const { memberships, workspaceOnboarding, invitationDeliveries, inviteWorkspaceMember } = createWorkspacesServices({
    ...createPostgresWorkspaceBindings(pool),
    invitationGateway: createSupabaseInvitationGateway({
      url: config.SUPABASE_URL,
      serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
      appBaseUrl: config.APP_BASE_URL,
    }),
  });
  const providerBindings = createConfiguredProviderBindings(config);
  const measuredEmbeddings = (
    identity: Parameters<typeof createWorkspaceEmbeddingAdapter>[0],
    tenantId?: string,
  ) =>
    measurements.embedding(
      createWorkspaceEmbeddingAdapter(identity, providerBindings.registry),
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
    ...createPostgresMcpBindings(pool, mcpReadPool, {
      callsPerMinute: config.MCP_CALLS_PER_MINUTE,
      callsPerDay: config.MCP_CALLS_PER_DAY,
      providerCallsPerDay: config.MCP_PROVIDER_CALLS_PER_DAY,
      inputTokensPerDay: config.MCP_INPUT_TOKENS_PER_DAY,
      userCostNanoUsdPerDay: Math.floor(config.MCP_USER_COST_USD_PER_DAY * 1e9),
      tenantCostNanoUsdPerDay: Math.floor(config.MCP_WORKSPACE_COST_USD_PER_DAY * 1e9),
      concurrentProviders: config.MCP_CONCURRENT_PROVIDERS,
    }),
    measuredEmbeddings,
    defaultEmbeddingIdentity: () => providerBindings.defaultEmbedding,
    options: {
      remote: config.MCP_REMOTE_ENABLED ? { resource: config.MCP_PUBLIC_URL!, appUrl: config.APP_BASE_URL! } : undefined,
      agentActionsEnabled: config.AGENT_ACTIONS_ENABLED,
      embeddingInputCostPer1kUsd: config.EMBEDDING_INPUT_COST_PER_1K_USD,
      maxCostNanoUsd: Math.floor(config.MCP_COST_USD_PER_CALL * 1e9),
    },
  });
  const embeddings = new WorkflowEmbeddingProvider(
    createWorkspaceEmbeddingProvider(new PgWorkspaceEmbeddingIndex(pool), providerBindings.defaultEmbedding, measuredEmbeddings),
    "default",
    config.EMBEDDING_DIMENSIONS,
    config.EMBEDDING_INPUT_COST_PER_1K_USD,
  );
  const rawReranker = providerBindings.registry.createReranker();
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
  const jobs = new PgIngestionJobRepository(pool);
  const { quotas, auditEvents } = createPostgresAccessBindings(pool);
  const originals = createSupabaseOriginalFileStore({
    url: config.SUPABASE_URL,
    serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
    uploadBucket: config.SUPABASE_UPLOAD_BUCKET,
  });
  const { chatRuns, conversations, semanticCache, workspaceModelPolicies } = createChatStorage(pool, config.EMBEDDING_DIMENSIONS);
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
  const modelProviders = createModelRuntimeProviders({
    registry: providerBindings.registry,
    guards: providerBindings.guards,
    measurements,
    options: providerBindings.options,
  });
  const { chatModels, defaultChat, compareAnswers, routeAnswer, defaultModel, embeddingModel, bindings: chatBindings } = createChatRuntime({
    embeddings, searchDocuments, semanticCache, usageMetrics, workspaceModelPolicies,
    ...createChatWorkflowBindings(chatRuns, { enabled: config.LANGSMITH_TRACING, projectName: config.LANGSMITH_PROJECT }),
    quota: quotas, aiProviders: modelProviders, options: chatRuntimeOptionsFromConfiguration(config),
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
  const embeddingVersion = async (tenantId: string) =>
    (await resolveWorkspaceEmbeddingIndex(embeddings, tenantId)).version ??
    "legacy-default";
  const workflows = createWorkspaceWorkflowServices({
    engine, chat: chatBindings, runEvaluation, evaluationVersion,
    member: memberships.findByUserAndTenant.bind(memberships), embeddingVersion,
    options: workspaceWorkflowOptionsFromConfiguration(config),
  });
  const enqueueIngestion = createIngestionWorkflow({
    jobs, engine, embeddingVersion,
    workflow: createIngestionWorkflowAdapter({ jobs, extractor, ingestDocument, originals, semanticCache }),
    options: ingestionWorkflowOptionsFromConfiguration(config),
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
      getDocumentOriginal,
      reindexDocument: new ReindexDocumentUseCase(jobs),
      deleteDocument,
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
