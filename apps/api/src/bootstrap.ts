import { AnswerQuestionUseCase } from "./application/use-cases/answer-question.js";
import { CompareAnswersUseCase } from "./application/use-cases/compare-answers.js";
import { RouteAnswerUseCase } from "./application/use-cases/route-answer.js";
import { defaultWorkspaceChatPolicy, resolveWorkspaceChatModels } from "./application/policies/workspace-chat-models.js";
import { IngestDocumentUseCase } from "./application/use-cases/ingest-document.js";
import { SearchDocumentsUseCase } from "./application/use-cases/search-documents.js";
import { QueueDocumentUploadUseCase } from "./application/use-cases/queue-document-upload.js";
import { ProcessNextIngestionJobUseCase } from "./application/use-cases/process-next-ingestion-job.js";
import { RetryIngestionJobUseCase } from "./application/use-cases/retry-ingestion-job.js";
import { ReindexDocumentUseCase } from "./application/use-cases/reindex-document.js";
import { DeleteDocumentUseCase } from "./application/use-cases/delete-document.js";
import { GetDocumentOriginalUseCase } from "./application/use-cases/get-document-original.js";
import { McpAccess } from "./application/mcp/access.js";
import { McpReadTools } from "./application/mcp/read-tools.js";
import { AgentActionService } from "./application/agent-actions/agent-action-service.js";
import { config } from "./config.js";
import type { AnswerGenerator } from "./application/ports/answer-generator.js";
import { resolveWorkspaceEmbeddingIndex } from "./application/ports/embedding-provider.js";
import type { Reranker } from "./application/ports/reranker.js";
import { BedrockAnswerGenerator } from "./infrastructure/bedrock/bedrock-answer-generator.js";
import { createBedrockClient } from "./infrastructure/bedrock/client.js";
import { createWorkspaceEmbeddingProvider } from "./infrastructure/embedding/workspace-embedding-provider.js";
import { LangGraphRagWorkflow } from "./infrastructure/langgraph/langgraph-rag-workflow.js";
import { LangSmithTracingWorkflow } from "./infrastructure/langsmith/langsmith-tracing-workflow.js";
import { JinaReranker } from "./infrastructure/jina/jina-reranker.js";
import { OllamaAnswerGenerator } from "./infrastructure/ollama/ollama-answer-generator.js";
import { OpenRouterAnswerGenerator } from "./infrastructure/openrouter/openrouter-answer-generator.js";
import { OpenRouterFaithfulnessJudge } from "./infrastructure/openrouter/openrouter-faithfulness-judge.js";
import { PgDocumentRepository } from "./infrastructure/postgres/pg-document-repository.js";
import { PgIngestionJobRepository } from "./infrastructure/postgres/pg-ingestion-job-repository.js";
import { PgQuotaRepository } from "./infrastructure/postgres/pg-quota-repository.js";
import { PgAuditEventRepository } from "./infrastructure/postgres/pg-audit-event-repository.js";
import { PgTenantMembershipRepository } from "./infrastructure/postgres/pg-tenant-membership-repository.js";
import { PgSemanticAnswerCache } from "./infrastructure/postgres/pg-semantic-answer-cache.js";
import { PgUsageMetricsRepository } from "./infrastructure/postgres/pg-usage-metrics-repository.js";
import { PgEvaluationRepository } from "./infrastructure/postgres/pg-evaluation-repository.js";
import { PgChatRunRepository } from "./infrastructure/postgres/pg-chat-run-repository.js";
import { PgWorkspaceOnboardingRepository } from "./infrastructure/postgres/pg-workspace-onboarding-repository.js";
import { PgWorkspaceModelPolicyRepository } from "./infrastructure/postgres/pg-workspace-model-policy-repository.js";
import { PgMcpAccessRepository } from "./infrastructure/postgres/pg-mcp-access-repository.js";
import { PgMcpReadRepository } from "./infrastructure/postgres/pg-mcp-read-repository.js";
import { PgAgentActionRepository } from "./infrastructure/postgres/pg-agent-action-repository.js";
import { RedactingAnswerGenerator } from "./infrastructure/security/redacting-answer-generator.js";
import { MultiFormatDocumentTextExtractor } from "./infrastructure/ingestion/document-text-extractor.js";
import { PopplerTesseractOcr } from "./infrastructure/ingestion/pdf-ocr.js";
import { HttpsPublicHtmlFetcher } from "./infrastructure/ingestion/public-html-fetcher.js";
import { createPostgresPool } from "./infrastructure/postgres/pool.js";
import { PassThroughReranker } from "./infrastructure/reranking/pass-through-reranker.js";
import { SupabaseOriginalFileStore } from "./infrastructure/storage/supabase-original-file-store.js";
import { RunEvaluationUseCase } from "./application/use-cases/run-evaluation.js";

export function createApplication() {
  const pool = createPostgresPool(config.DATABASE_URL);
  const mcpReadPool = config.MCP_ENABLED ? createPostgresPool(config.MCP_READ_DATABASE_URL ?? config.DATABASE_URL, 2) : null;
  const embeddings = createWorkspaceEmbeddingProvider(pool);
  const reranker = createReranker();
  const documents = new PgDocumentRepository(pool, config.EMBEDDING_DIMENSIONS);
  const jobs = new PgIngestionJobRepository(pool);
  const quotas = new PgQuotaRepository(pool);
  const auditEvents = new PgAuditEventRepository(pool);
  const memberships = new PgTenantMembershipRepository(pool);
  const semanticCache = new PgSemanticAnswerCache(pool, config.EMBEDDING_DIMENSIONS);
  const usageMetrics = new PgUsageMetricsRepository(pool);
  const evaluations = new PgEvaluationRepository(pool);
  const workspaceModelPolicies = new PgWorkspaceModelPolicyRepository(pool);
  const chatRuns = new PgChatRunRepository(pool);
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
  const workflowOptions = {
    maxContextChars: 12_000,
    minimumScore: config.RAG_MINIMUM_SCORE,
    maxSteps: config.AGENT_MAX_STEPS,
    timeoutMs: config.AGENT_TIMEOUT_MS,
    requireStructuredOutput: config.REQUIRE_STRUCTURED_ANSWER
  };
  const defaultModel = {
    ollama: config.OLLAMA_CHAT_MODEL, openrouter: config.OPENROUTER_CHAT_MODEL, bedrock: config.BEDROCK_CHAT_MODEL_ID
  }[config.CHAT_PROVIDER];
  const embeddingModel = {
    ollama: config.OLLAMA_EMBEDDING_MODEL, openrouter: config.OPENROUTER_EMBEDDING_MODEL, bedrock: config.BEDROCK_EMBEDDING_MODEL_ID
  }[config.EMBEDDING_PROVIDER];
  const cacheVariant = JSON.stringify([
    config.EMBEDDING_PROVIDER, embeddingModel, config.RERANKER_PROVIDER,
    config.RERANKER_PROVIDER === "jina" ? config.JINA_RERANKER_MODEL : null,
    config.RETRIEVAL_TOP_K, config.RAG_MINIMUM_SCORE, config.REQUIRE_STRUCTURED_ANSWER, config.CHAT_MAX_OUTPUT_TOKENS
  ]);
  const modelConfigs = [{
    id: "default",
    label: config.CHAT_DEFAULT_MODEL_LABEL ?? defaultModel.slice(0, 80),
    model: defaultModel,
    provider: config.CHAT_PROVIDER,
    inputCostPer1kUsd: config.ESTIMATED_INPUT_COST_PER_1K_USD,
    outputCostPer1kUsd: config.ESTIMATED_OUTPUT_COST_PER_1K_USD
  }, ...config.CHAT_ADDITIONAL_MODELS];
  if (new Set(modelConfigs.map(({ model, provider }) => `${provider ?? config.CHAT_PROVIDER}:${model}`)).size !== modelConfigs.length) {
    throw new Error("Chat model IDs must be distinct, including the default model.");
  }
  const chatModels = new Map(modelConfigs.map(({ id, label, model, provider = config.CHAT_PROVIDER, inputCostPer1kUsd, outputCostPer1kUsd }) => {
    const descriptor = { id, label, provider, isDefault: id === "default" };
    const generator = new RedactingAnswerGenerator(createAnswerGenerator(provider, model, config.CHAT_MAX_OUTPUT_TOKENS));
    const workflow = new LangGraphRagWorkflow(searchDocuments, generator, workflowOptions);
    const answerWorkflow = new LangSmithTracingWorkflow(workflow, {
      enabled: config.LANGSMITH_TRACING,
      projectName: config.LANGSMITH_PROJECT
    });
    const answerQuestion = new AnswerQuestionUseCase(answerWorkflow, embeddings, semanticCache, usageMetrics, {
      cacheTtlSeconds: config.SEMANTIC_CACHE_TTL_SECONDS,
      cacheMinimumSimilarity: config.SEMANTIC_CACHE_MINIMUM_SIMILARITY,
      cacheVariant,
      provider: descriptor.provider,
      model,
      maxOutputTokens: config.CHAT_MAX_OUTPUT_TOKENS,
      maxEstimatedCostUsd: config.MAX_ESTIMATED_COST_USD_PER_REQUEST,
      inputCostPer1kUsd,
      outputCostPer1kUsd
    });
    return [id, { descriptor, model, generator, workflow, answerQuestion, inputCostPer1kUsd, outputCostPer1kUsd }] as const;
  }));
  const defaultChat = chatModels.get("default")!;
  const judge = config.EVAL_FAITHFULNESS_JUDGE_MODEL
    ? new OpenRouterFaithfulnessJudge(config.OPENROUTER_BASE_URL, config.OPENROUTER_API_KEY as string, config.EVAL_FAITHFULNESS_JUDGE_MODEL)
    : undefined;
  const compareAnswers = new CompareAnswersUseCase(defaultChat.workflow, usageMetrics, {
    timeoutMs: config.AGENT_TIMEOUT_MS,
    maxOutputTokens: config.CHAT_MAX_OUTPUT_TOKENS,
    maxEstimatedCostUsd: config.MAX_ESTIMATED_COST_USD_PER_REQUEST
  });
  const routeAnswer = new RouteAnswerUseCase(defaultChat.workflow, usageMetrics, {
    timeoutMs: config.AGENT_TIMEOUT_MS,
    maxOutputTokens: config.CHAT_MAX_OUTPUT_TOKENS,
    maxTotalOutputTokens: config.CHAT_AUTO_MAX_TOTAL_OUTPUT_TOKENS ?? config.CHAT_MAX_OUTPUT_TOKENS * 2,
    maxTotalInputTokens: config.CHAT_AUTO_MAX_TOTAL_INPUT_TOKENS,
    maxEstimatedCostUsd: config.MAX_ESTIMATED_COST_USD_PER_REQUEST
  });

  const ingestDocument = new IngestDocumentUseCase(embeddings, documents, {
    chunkSize: config.CHUNK_SIZE,
    chunkOverlap: config.CHUNK_OVERLAP,
    embeddingConcurrency: 3
  });
  const extractor = new MultiFormatDocumentTextExtractor({
    ocr: config.PDF_OCR_ENABLED ? new PopplerTesseractOcr({
      languages: config.PDF_OCR_LANGUAGES,
      timeoutMs: config.PDF_OCR_TIMEOUT_MS
    }) : undefined,
    maxOcrPages: config.PDF_OCR_MAX_PAGES
  });
  return {
    useCases: {
      ingestDocument,
      queueDocumentUpload: new QueueDocumentUploadUseCase(jobs, originals),
      publicHtmlFetcher: new HttpsPublicHtmlFetcher({ maxBytes: Math.min(config.UPLOAD_MAX_BYTES, 1_000_000), timeoutMs: 10_000 }),
      processNextIngestionJob: new ProcessNextIngestionJobUseCase(jobs, extractor, ingestDocument, originals, semanticCache),
      retryIngestionJob: new RetryIngestionJobUseCase(jobs),
      listIngestionJobs: (tenantId: string, limit: number) => jobs.list(tenantId, limit),
      listIngestionEvents: (jobId: string, tenantId: string, limit: number) => jobs.listEvents(jobId, tenantId, limit),
      previewIngestionPassages: jobs.previewPassages.bind(jobs),
      listMemberships: memberships.listByUserId.bind(memberships),
      findMembership: memberships.findByUserAndTenant.bind(memberships),
      createWorkspace: memberships.createWorkspace.bind(memberships),
      listWorkspaceMembers: memberships.listMembers.bind(memberships),
      addWorkspaceMember: memberships.addMember.bind(memberships),
      changeWorkspaceMemberRole: memberships.changeMemberRole.bind(memberships),
      removeWorkspaceMember: memberships.removeMember.bind(memberships),
      recordWorkspaceInvitation: memberships.recordInvitation.bind(memberships),
      listDocuments: (tenantId: string, limit: number) => documents.list(tenantId, limit),
      listDocumentChunks: (tenantId: string, documentId: string, limit: number) => documents.listChunks({ tenantId, documentId, limit }),
      getDocumentOriginal: new GetDocumentOriginalUseCase(jobs, originals),
      reindexDocument: new ReindexDocumentUseCase(jobs),
      deleteDocument: new DeleteDocumentUseCase(documents, jobs, originals),
      consumeQuestionQuota: (tenantId: string, actorKey: string, units?: 1 | 2) => quotas.consumeQuestion({ tenantId, actorKey, units, tenantLimit: config.DAILY_TENANT_QA_LIMIT, actorLimit: config.DAILY_USER_QA_LIMIT }),
      consumeAdminUploadQuota: (tenantId: string, actorKey: string, bytes: number) => quotas.consumeUpload({ tenantId, actorKey, bytes, limit: config.DAILY_ADMIN_UPLOAD_BYTES_LIMIT }),
      getUsageSummary: (tenantId: string, days: number) => usageMetrics.summarize({ tenantId, days }),
      listEvaluationRuns: (tenantId: string, limit: number) => evaluations.list(tenantId, limit),
      runEvaluation: new RunEvaluationUseCase(searchDocuments, evaluations, {
        embeddingProvider: config.EMBEDDING_PROVIDER,
        embeddingModel,
        chatProvider: config.CHAT_PROVIDER,
        chatModel: defaultModel
      }, judge ? {
        judge,
        async resolveModel(tenantId, modelId, requestedMaxOutputTokens) {
          const policy = await workspaceModelPolicies.get(tenantId) ?? defaultWorkspaceChatPolicy(chatModels);
          const profile = resolveWorkspaceChatModels(chatModels, policy);
          const model = profile.models.get(modelId ?? profile.defaultModelId ?? "");
          if (!model) return undefined;
          const { descriptor: { provider }, model: modelName, inputCostPer1kUsd, outputCostPer1kUsd } = model;
          const maxOutputTokens = Math.min(requestedMaxOutputTokens, config.CHAT_MAX_OUTPUT_TOKENS);
          const generator = new RedactingAnswerGenerator(createAnswerGenerator(provider, modelName, maxOutputTokens));
          return { provider, model: modelName, generator, inputCostPer1kUsd, outputCostPer1kUsd, maxOutputTokens };
        }
      } : undefined, async (tenantId) => {
        const { identity, version } = await resolveWorkspaceEmbeddingIndex(embeddings, tenantId);
        return identity ? { provider: identity.provider, model: identity.model, version } : undefined;
      }),
      invalidateSemanticCache: (tenantId: string) => semanticCache.invalidateTenant(tenantId),
      recordAuditEvent: auditEvents.record.bind(auditEvents),
      searchDocuments,
      chatRuns,
      workspaceOnboarding: new PgWorkspaceOnboardingRepository(pool),
      chatModels,
      workspaceModelPolicies,
      workspaceMcp: mcpReadPool ? {
        access: new McpAccess(new PgMcpAccessRepository(pool)),
        tools: new McpReadTools(new PgMcpReadRepository(mcpReadPool))
      } : undefined,
      agentActions: config.AGENT_ACTIONS_ENABLED ? new AgentActionService(new PgAgentActionRepository(pool)) : undefined,
      compareAnswers,
      routeAnswer,
      answerQuestion: defaultChat.answerQuestion
    },
    close: async () => { await Promise.all([pool.end(), mcpReadPool?.end()]); }
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

function createAnswerGenerator(provider: typeof config.CHAT_PROVIDER, model: string, maxOutputTokens: number): AnswerGenerator {
  switch (provider) {
    case "ollama":
      return new OllamaAnswerGenerator(config.OLLAMA_BASE_URL, model, maxOutputTokens);
    case "openrouter":
      return new OpenRouterAnswerGenerator(
        config.OPENROUTER_BASE_URL,
        config.OPENROUTER_API_KEY as string,
        model,
        maxOutputTokens
      );
    case "bedrock": {
      const bedrock = createBedrockClient(config.AWS_REGION, 1);
      return new BedrockAnswerGenerator(bedrock, model, maxOutputTokens);
    }
  }
}

