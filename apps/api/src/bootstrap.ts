import { InviteWorkspaceMember } from "./application/integrations/workspace-invitations.js";
import { PgInvitationDeliveries } from "./infrastructure/postgres/pg-invitation-deliveries.js";
import { SupabaseInvitationGateway } from "./infrastructure/auth/supabase-invitation-gateway.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { GroundedClaimVerifier } from "./application/policies/claim-verification.js";
import { WorkspaceWorkflows } from "./application/workflows/workspace-workflows.js";
import { WorkflowGuardError } from "./application/workflows/types.js";
import { DurableWorkflowRunner } from "./infrastructure/langgraph/durable-workflow-runner.js";
import {
  LangGraphChatWorkflow,
  chatWorkflowVersion,
} from "./infrastructure/langgraph/langgraph-chat-workflow.js";
import {
  LangGraphIngestionWorkflow,
  ingestionWorkflowVersion,
} from "./infrastructure/langgraph/langgraph-ingestion-workflow.js";
import {
  LangGraphEvaluationWorkflow,
  evaluationWorkflowVersion,
} from "./infrastructure/langgraph/langgraph-evaluation-workflow.js";
import { PgWorkflowRepository } from "./infrastructure/postgres/pg-workflow-repository.js";
import { PgWorkflowCheckpointer } from "./infrastructure/langgraph/pg-workflow-checkpointer.js";
import { BudgetAlerts } from "./infrastructure/observability/budget-alerts.js";
import { ProviderMeasurements } from "./infrastructure/observability/measured-providers.js";
import {
  workflowCodecFromEnvironment,
  WorkflowStateCodec,
} from "./infrastructure/security/workflow-state-codec.js";
import {
  WorkflowAnswerGenerator,
  WorkflowEmbeddingProvider,
  WorkflowFaithfulnessJudge,
  WorkflowReranker,
} from "./infrastructure/security/workflow-provider-guards.js";
import { AnswerQuestionUseCase } from "./application/use-cases/answer-question.js";
import { CompareAnswersUseCase } from "./application/use-cases/compare-answers.js";
import { RouteAnswerUseCase } from "./application/use-cases/route-answer.js";
import {
  defaultWorkspaceChatPolicy,
  resolveWorkspaceChatModels,
} from "./application/policies/workspace-chat-models.js";
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
import { McpHybridSearch } from "./application/mcp/hybrid-search.js";
import { McpOAuth } from "./application/mcp/oauth.js";
import { PgMcpControls } from "./infrastructure/postgres/pg-mcp-controls.js";
import { PgConversationRepository } from "./infrastructure/postgres/pg-conversation-repository.js";
import { PgMcpOAuthRepository } from "./infrastructure/postgres/pg-mcp-oauth-repository.js";
import { AgentActionService } from "./application/agent-actions/agent-action-service.js";
import { config } from "./config.js";
import type { AnswerGenerator } from "./application/ports/answer-generator.js";
import { resolveWorkspaceEmbeddingIndex } from "./application/ports/embedding-provider.js";
import type { Reranker } from "./application/ports/reranker.js";
import { BedrockAnswerGenerator } from "./infrastructure/bedrock/bedrock-answer-generator.js";
import { createBedrockClient } from "./infrastructure/bedrock/client.js";
import {
  createWorkspaceEmbeddingAdapter,
  createWorkspaceEmbeddingProvider,
  defaultWorkspaceEmbeddingModel,
} from "./infrastructure/embedding/workspace-embedding-provider.js";
import { LangGraphRagWorkflow } from "./infrastructure/langgraph/langgraph-rag-workflow.js";
import { LangSmithTracingWorkflow } from "./infrastructure/langsmith/langsmith-tracing-workflow.js";
import { JinaReranker } from "./infrastructure/jina/jina-reranker.js";
import { OllamaAnswerGenerator } from "./infrastructure/ollama/ollama-answer-generator.js";
import { OpenRouterAnswerGenerator } from "./infrastructure/openrouter/openrouter-answer-generator.js";
import { OpenRouterFaithfulnessJudge } from "./infrastructure/openrouter/openrouter-faithfulness-judge.js";
import { PgDocumentRepository } from "./infrastructure/postgres/pg-document-repository.js";
import { PgKnowledgeStatusRepository } from "./infrastructure/postgres/pg-knowledge-status-repository.js";
import { PgDemoLibraryRepository } from "./infrastructure/postgres/pg-demo-library-repository.js";
import type { DocumentFilters } from "@rag-study/contracts";
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
  const rawUsageMetrics = new PgUsageMetricsRepository(pool);
  const budgetAlerts = new BudgetAlerts(pool, {
    url: config.BUDGET_ALERT_WEBHOOK_URL,
    secret: config.BUDGET_ALERT_WEBHOOK_SECRET,
    thresholdUsd: config.USAGE_ALERT_THRESHOLD_USD,
    log: (record) => process.stdout.write(JSON.stringify(record) + "\n"),
  });
  const usageMetrics = {
    summarize: rawUsageMetrics.summarize.bind(rawUsageMetrics),
    record: async (input: Parameters<typeof rawUsageMetrics.record>[0]) => {
      await rawUsageMetrics.record(input);
      await budgetAlerts
        .enqueue(input.tenantId)
        .catch(() =>
          process.stdout.write(
            '{"event":"budget_alert_enqueue","reason":"database_unavailable"}\n',
          ),
        );
    },
  };
  const measurements = new ProviderMeasurements(usageMetrics);
  const invitationDeliveries = new PgInvitationDeliveries(pool);
  const inviteWorkspaceMember = new InviteWorkspaceMember(
    invitationDeliveries,
    new SupabaseInvitationGateway(
      config.SUPABASE_URL,
      config.SUPABASE_SERVICE_ROLE_KEY,
      config.APP_BASE_URL,
    ),
  );
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
  const mcpControls = new PgMcpControls(pool, {
    callsPerMinute: config.MCP_CALLS_PER_MINUTE,
    callsPerDay: config.MCP_CALLS_PER_DAY,
    providerCallsPerDay: config.MCP_PROVIDER_CALLS_PER_DAY,
    inputTokensPerDay: config.MCP_INPUT_TOKENS_PER_DAY,
    userCostNanoUsdPerDay: Math.floor(config.MCP_USER_COST_USD_PER_DAY * 1e9),
    tenantCostNanoUsdPerDay: Math.floor(
      config.MCP_WORKSPACE_COST_USD_PER_DAY * 1e9,
    ),
    concurrentProviders: config.MCP_CONCURRENT_PROVIDERS,
  });
  const mcpReads = mcpReadPool ? new PgMcpReadRepository(mcpReadPool) : null;
  const mcpTools = mcpReads
    ? new McpReadTools(
        mcpReads,
        new McpHybridSearch(
          mcpReads,
          mcpControls,
          measuredEmbeddings,
          [
            {
              ...defaultWorkspaceEmbeddingModel(),
              inputCostPer1kUsd: config.EMBEDDING_INPUT_COST_PER_1K_USD,
            },
          ],
          {
            maxInputTokens: 2048,
            maxCostNanoUsd: Math.floor(config.MCP_COST_USD_PER_CALL * 1e9),
          },
        ),
      )
    : null;
  const embeddings = new WorkflowEmbeddingProvider(
    createWorkspaceEmbeddingProvider(pool, measuredEmbeddings),
    "default",
    config.EMBEDDING_DIMENSIONS,
    config.EMBEDDING_INPUT_COST_PER_1K_USD,
  );
  const rawReranker = createReranker();
  const reranker = new WorkflowReranker(
    rawReranker.enabled
      ? measurements.reranker(rawReranker, {
          provider: "jina",
          model: config.JINA_RERANKER_MODEL,
          inputPrice: config.JINA_INPUT_COST_PER_1K_USD,
        })
      : rawReranker,
  );
  const documents = new PgDocumentRepository(pool, config.EMBEDDING_DIMENSIONS);
  const demoLibraryRepository = new PgDemoLibraryRepository(pool);
  const jobs = new PgIngestionJobRepository(pool);
  const quotas = new PgQuotaRepository(pool);
  const auditEvents = new PgAuditEventRepository(pool);
  const memberships = new PgTenantMembershipRepository(pool);
  const semanticCache = new PgSemanticAnswerCache(
    pool,
    config.EMBEDDING_DIMENSIONS,
  );
  const evaluations = new PgEvaluationRepository(pool);
  const workspaceModelPolicies = new PgWorkspaceModelPolicyRepository(pool);
  const chatRuns = new PgChatRunRepository(pool);
  const originals = new SupabaseOriginalFileStore(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
    config.SUPABASE_UPLOAD_BUCKET,
  );
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
  const workflowOptions = {
    maxContextChars: 12_000,
    minimumScore: config.RAG_MINIMUM_SCORE,
    maxSteps: config.AGENT_MAX_STEPS,
    timeoutMs: config.AGENT_TIMEOUT_MS,
    requireStructuredOutput: config.REQUIRE_STRUCTURED_ANSWER,
  };
  const defaultModel = {
    ollama: config.OLLAMA_CHAT_MODEL,
    openrouter: config.OPENROUTER_CHAT_MODEL,
    bedrock: config.BEDROCK_CHAT_MODEL_ID,
  }[config.CHAT_PROVIDER];
  const embeddingModel = {
    ollama: config.OLLAMA_EMBEDDING_MODEL,
    openrouter: config.OPENROUTER_EMBEDDING_MODEL,
    bedrock: config.BEDROCK_EMBEDDING_MODEL_ID,
  }[config.EMBEDDING_PROVIDER];
  const cacheVariant = JSON.stringify([
    "rag-claims-v2",
    config.RAG_CLAIM_MODE,
    config.EMBEDDING_PROVIDER,
    embeddingModel,
    config.RERANKER_PROVIDER,
    config.RERANKER_PROVIDER === "jina" ? config.JINA_RERANKER_MODEL : null,
    config.RETRIEVAL_TOP_K,
    config.RAG_MINIMUM_SCORE,
    config.REQUIRE_STRUCTURED_ANSWER,
    config.CHAT_MAX_OUTPUT_TOKENS,
  ]);
  const modelConfigs = [
    {
      id: "default",
      label: config.CHAT_DEFAULT_MODEL_LABEL ?? defaultModel.slice(0, 80),
      model: defaultModel,
      provider: config.CHAT_PROVIDER,
      inputCostPer1kUsd: config.ESTIMATED_INPUT_COST_PER_1K_USD,
      outputCostPer1kUsd: config.ESTIMATED_OUTPUT_COST_PER_1K_USD,
    },
    ...config.CHAT_ADDITIONAL_MODELS,
  ];
  if (
    new Set(
      modelConfigs.map(
        ({ model, provider }) => `${provider ?? config.CHAT_PROVIDER}:${model}`,
      ),
    ).size !== modelConfigs.length
  ) {
    throw new Error(
      "Chat model IDs must be distinct, including the default model.",
    );
  }
  const claimVerifiers = new Map<string, GroundedClaimVerifier>();
  const chatModels = new Map(
    modelConfigs.map(
      ({
        id,
        label,
        model,
        provider = config.CHAT_PROVIDER,
        inputCostPer1kUsd,
        outputCostPer1kUsd,
      }) => {
        const descriptor = { id, label, provider, isDefault: id === "default" };
        const pricing = { inputCostPer1kUsd, outputCostPer1kUsd };
        const generator = new WorkflowAnswerGenerator(
          measurements.evaluationGenerator(
            new RedactingAnswerGenerator(
              createAnswerGenerator(
                provider,
                model,
                config.CHAT_MAX_OUTPUT_TOKENS,
              ),
            ),
            {
              provider,
              model,
              inputPrice: inputCostPer1kUsd,
              outputPrice: outputCostPer1kUsd,
            },
          ),
          id,
          pricing,
          config.CHAT_MAX_OUTPUT_TOKENS,
        );
        const claimJudge =
          config.RAG_CLAIM_MODE === "model" && provider === "openrouter"
            ? new WorkflowFaithfulnessJudge(
                measurements.judge(
                  new OpenRouterFaithfulnessJudge(
                    config.OPENROUTER_BASE_URL,
                    config.OPENROUTER_API_KEY!,
                    model,
                  ),
                  {
                    provider,
                    model,
                    inputPrice: inputCostPer1kUsd,
                    outputPrice: outputCostPer1kUsd,
                  },
                  "evidence_judging",
                ),
                pricing,
              )
            : undefined;
        const verifier = new GroundedClaimVerifier(claimJudge);
        claimVerifiers.set(id, verifier);
        const workflow = new LangGraphRagWorkflow(searchDocuments, generator, {
          ...workflowOptions,
          workflowId: id,
          claimVerifier: verifier,
          claimVerifierFor: (target) =>
            claimVerifiers.get(target.checkpointKey?.split(":")[0] ?? id) ??
            new GroundedClaimVerifier(),
        });
        const answerWorkflow = new LangSmithTracingWorkflow(workflow, {
          enabled: config.LANGSMITH_TRACING,
          projectName: config.LANGSMITH_PROJECT,
        });
        const answerQuestion = new AnswerQuestionUseCase(
          answerWorkflow,
          embeddings,
          semanticCache,
          usageMetrics,
          {
            cacheTtlSeconds: config.SEMANTIC_CACHE_TTL_SECONDS,
            cacheMinimumSimilarity: config.SEMANTIC_CACHE_MINIMUM_SIMILARITY,
            cacheVariant,
            provider: descriptor.provider,
            model,
            maxOutputTokens: config.CHAT_MAX_OUTPUT_TOKENS,
            maxEstimatedCostUsd: config.MAX_ESTIMATED_COST_USD_PER_REQUEST,
            inputCostPer1kUsd,
            outputCostPer1kUsd,
          },
        );
        return [
          id,
          {
            descriptor,
            model,
            generator,
            workflow,
            answerQuestion,
            inputCostPer1kUsd,
            outputCostPer1kUsd,
          },
        ] as const;
      },
    ),
  );
  const defaultChat = chatModels.get("default")!;
  const judge = config.EVAL_FAITHFULNESS_JUDGE_MODEL
    ? new WorkflowFaithfulnessJudge(
        measurements.judge(
          new OpenRouterFaithfulnessJudge(
            config.OPENROUTER_BASE_URL,
            config.OPENROUTER_API_KEY as string,
            config.EVAL_FAITHFULNESS_JUDGE_MODEL,
          ),
          {
            provider: "openrouter",
            model: config.EVAL_FAITHFULNESS_JUDGE_MODEL,
            inputPrice: config.EVAL_JUDGE_INPUT_COST_PER_1K_USD,
            outputPrice: config.EVAL_JUDGE_OUTPUT_COST_PER_1K_USD,
          },
          "evaluation_judging",
        ),
        {
          inputCostPer1kUsd: config.EVAL_JUDGE_INPUT_COST_PER_1K_USD,
          outputCostPer1kUsd: config.EVAL_JUDGE_OUTPUT_COST_PER_1K_USD,
        },
      )
    : undefined;
  const compareAnswers = new CompareAnswersUseCase(
    defaultChat.workflow,
    usageMetrics,
    {
      timeoutMs: config.AGENT_TIMEOUT_MS,
      maxOutputTokens: config.CHAT_MAX_OUTPUT_TOKENS,
      maxEstimatedCostUsd: config.MAX_ESTIMATED_COST_USD_PER_REQUEST,
    },
  );
  const routeAnswer = new RouteAnswerUseCase(
    defaultChat.workflow,
    usageMetrics,
    {
      timeoutMs: config.AGENT_TIMEOUT_MS,
      maxOutputTokens: config.CHAT_MAX_OUTPUT_TOKENS,
      maxTotalOutputTokens:
        config.CHAT_AUTO_MAX_TOTAL_OUTPUT_TOKENS ??
        config.CHAT_MAX_OUTPUT_TOKENS * 2,
      maxTotalInputTokens: config.CHAT_AUTO_MAX_TOTAL_INPUT_TOKENS,
      maxEstimatedCostUsd: config.MAX_ESTIMATED_COST_USD_PER_REQUEST,
    },
  );

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
  const codec = config.WORKFLOWS_ENABLED
    ? workflowCodecFromEnvironment(config)
    : undefined;
  const workflowRepository = codec
    ? new PgWorkflowRepository(pool, codec)
    : undefined;
  const engine =
    workflowRepository && codec
      ? new DurableWorkflowRunner(
          workflowRepository,
          (lease, graph) =>
            new PgWorkflowCheckpointer(workflowRepository, lease, graph),
          (code) =>
            console.error(
              JSON.stringify({ event: "workflow_failure", reason: code }),
            ),
        )
      : undefined;
  const runEvaluation = new RunEvaluationUseCase(
    searchDocuments,
    evaluations,
    {
      embeddingProvider: config.EMBEDDING_PROVIDER,
      embeddingModel,
      chatProvider: config.CHAT_PROVIDER,
      chatModel: defaultModel,
    },
    judge
      ? {
          judge,
          async resolveModel(tenantId, modelId, requestedMaxOutputTokens) {
            const policy =
              (await workspaceModelPolicies.get(tenantId)) ??
              defaultWorkspaceChatPolicy(chatModels);
            const profile = resolveWorkspaceChatModels(chatModels, policy);
            const model = profile.models.get(
              modelId ?? profile.defaultModelId ?? "",
            );
            if (!model) return undefined;
            const {
              descriptor: { provider },
              model: modelName,
              inputCostPer1kUsd,
              outputCostPer1kUsd,
            } = model;
            const maxOutputTokens = Math.min(
              requestedMaxOutputTokens,
              config.CHAT_MAX_OUTPUT_TOKENS,
            );
            const generator = new WorkflowAnswerGenerator(
              measurements.evaluationGenerator(
                new RedactingAnswerGenerator(
                  createAnswerGenerator(provider, modelName, maxOutputTokens),
                ),
                {
                  provider,
                  model: modelName,
                  inputPrice: inputCostPer1kUsd,
                  outputPrice: outputCostPer1kUsd,
                },
              ),
              `evaluation:${modelId ?? "default"}:${maxOutputTokens}`,
              { inputCostPer1kUsd, outputCostPer1kUsd },
              maxOutputTokens,
            );
            return {
              provider,
              model: modelName,
              generator,
              inputCostPer1kUsd,
              outputCostPer1kUsd,
              maxOutputTokens,
            };
          },
        }
      : undefined,
    async (tenantId) => {
      const { identity, version } = await resolveWorkspaceEmbeddingIndex(
        embeddings,
        tenantId,
      );
      return identity
        ? { provider: identity.provider, model: identity.model, version }
        : undefined;
    },
    async (tenantId) =>
      (
        await demoLibraryRepository.sourceStates(tenantId, [
          "golden/rag-fundamentals",
        ])
      )[0]?.state === "ready",
    engine
      ? new LangGraphEvaluationWorkflow(
          searchDocuments,
          evaluations,
          {
            embeddingProvider: config.EMBEDDING_PROVIDER,
            embeddingModel,
            chatProvider: config.CHAT_PROVIDER,
            chatModel: defaultModel,
          },
          async (tenantId) => {
            const { identity, version } = await resolveWorkspaceEmbeddingIndex(
              embeddings,
              tenantId,
            );
            return identity
              ? { provider: identity.provider, model: identity.model, version }
              : undefined;
          },
        )
      : undefined,
  );
  const resolveChat = async (tenantId: string, modelId?: string) => {
    const policy =
      (await workspaceModelPolicies.get(tenantId)) ??
      defaultWorkspaceChatPolicy(chatModels);
    const profile = resolveWorkspaceChatModels(chatModels, policy);
    const selected = modelId ?? profile.defaultModelId ?? "";
    const fingerprint = (model: typeof defaultChat) => [
      model.descriptor.id,
      model.descriptor.provider,
      model.model,
      model.inputCostPer1kUsd,
      model.outputCostPer1kUsd,
    ];
    const signature = (plan: unknown) =>
      createHash("sha256")
        .update(
          JSON.stringify([
            plan,
            cacheVariant,
            config.CHAT_MAX_OUTPUT_TOKENS,
            config.RAG_CLAIM_MODE,
          ]),
        )
        .digest("hex");
    if (selected === "auto") {
      const auto = profile.auto,
        simple = auto && profile.models.get(auto.simpleModelId),
        complex = auto && profile.models.get(auto.complexModelId);
      if (!auto || !simple || !complex) return null;
      const fallbacks = auto.fallbackModelIds.flatMap((id) => {
        const model = profile.models.get(id);
        return model ? [model] : [];
      });
      return {
        modelId: "auto",
        signature: signature([simple, complex, ...fallbacks].map(fingerprint)),
        execute: (input: Parameters<AnswerQuestionUseCase["execute"]>[0]) =>
          routeAnswer.execute({
            ...input,
            simple,
            complex,
            fallbacks,
            reserveFallbackQuota: async (id) =>
              (
                await quotas.consumeQuestion({
                  tenantId: input.tenantId,
                  actorKey: input.actorKey,
                  receiptKey: `fallback:${id}`,
                  tenantLimit: config.DAILY_TENANT_QA_LIMIT,
                  actorLimit: config.DAILY_USER_QA_LIMIT,
                })
              ).allowed,
          }),
      };
    }
    const model = profile.models.get(selected);
    if (!model) return null;
    return {
      modelId: selected,
      signature: signature(fingerprint(model)),
      execute: async (
        input: Parameters<AnswerQuestionUseCase["execute"]>[0],
      ) => ({
        ...(await model.answerQuestion.execute(input)),
        model: model.descriptor,
        providerModel: model.model,
      }),
    };
  };
  const embeddingVersion = async (tenantId: string) =>
    (await resolveWorkspaceEmbeddingIndex(embeddings, tenantId)).version ??
    "legacy-default";
  const chatGraph = new LangGraphChatWorkflow(chatRuns);
  const workflows = engine
    ? new WorkspaceWorkflows({
        engine,
        chatVersion: chatWorkflowVersion,
        evaluationVersion: evaluationWorkflowVersion,
        chatBudget: {
          maxSteps: 50,
          maxCalls: 16,
          maxInputTokens: 320_000,
          maxOutputTokens: Math.min(
            64_000,
            config.CHAT_MAX_OUTPUT_TOKENS * 4 + 3_600,
          ),
          maxCostMicros: Math.floor(
            config.MAX_ESTIMATED_COST_USD_PER_REQUEST * 1_000_000,
          ),
          timeoutMs: config.AGENT_TIMEOUT_MS,
        },
        evaluationBudget: {
          maxSteps: 50,
          maxCalls: 32,
          maxInputTokens: 500_000,
          maxOutputTokens: 16_000,
          maxCostMicros: Math.floor(
            config.WORKFLOW_EVAL_MAX_COST_USD * 1_000_000,
          ),
          timeoutMs: 120_000,
        },
        member: memberships.findByUserAndTenant.bind(memberships),
        resolveChat,
        embeddingVersion,
        consumeQuota: async (tenantId, actorKey) =>
          (
            await quotas.consumeQuestion({
              tenantId,
              actorKey,
              receiptKey: "primary",
              tenantLimit: config.DAILY_TENANT_QA_LIMIT,
              actorLimit: config.DAILY_USER_QA_LIMIT,
            })
          ).allowed,
        runChat: chatGraph.execute.bind(chatGraph),
        runEvaluation,
      })
    : undefined;
  const ingestionGraph = new LangGraphIngestionWorkflow(
    jobs,
    extractor,
    ingestDocument,
    originals,
    semanticCache,
  );
  const ingestionPlan = createHash("sha256")
    .update(
      JSON.stringify([
        ingestionWorkflowVersion,
        config.CHUNK_SIZE,
        config.CHUNK_OVERLAP,
        config.PDF_OCR_ENABLED,
        config.PDF_OCR_LANGUAGES,
        config.PDF_OCR_MAX_PAGES,
        config.PDF_OCR_TIMEOUT_MS,
      ]),
    )
    .digest("hex");
  const ingestionInput = z.strictObject({
    jobId: z.string().uuid(),
    plan: z.string(),
    indexVersion: z.string(),
  });
  engine?.register("ingestion", {
    version: ingestionWorkflowVersion,
    authorize: async (lease) => {
      const input = ingestionInput.parse(lease.input),
        job = await jobs.readForProcessing(input.jobId, lease.tenantId);
      return (
        input.jobId === lease.runId &&
        input.plan === ingestionPlan &&
        input.indexVersion === (await embeddingVersion(lease.tenantId)) &&
        Boolean(
          job && (job.status === "processing" || job.status === "completed"),
        )
      );
    },
    run: async (lease, signal) => {
      const input = ingestionInput.parse(lease.input),
        job = await jobs.readForProcessing(input.jobId, lease.tenantId);
      if (!job) throw new WorkflowGuardError("authorization_revoked");
      const result = await ingestionGraph.execute(job, signal);
      return { resultId: result.id };
    },
  });
  const enqueueIngestion = engine
    ? async (
        job: import("./application/ports/ingestion-job-repository.js").IngestionJob,
      ) => {
        await engine.submit({
          tenantId: job.tenantId,
          actorId: "ingestion",
          runId: job.id,
          kind: "ingestion",
          version: ingestionWorkflowVersion,
          input: {
            jobId: job.id,
            plan: ingestionPlan,
            indexVersion: await embeddingVersion(job.tenantId),
          },
          budget: {
            maxSteps: 60,
            maxCalls: 1_024,
            maxInputTokens: 2_000_000,
            maxOutputTokens: 0,
            maxCostMicros: Math.floor(
              config.WORKFLOW_INGEST_MAX_COST_USD * 1_000_000,
            ),
            timeoutMs: 300_000,
          },
        });
      }
    : undefined;
  return {
    useCases: {
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
      knowledgeStatus: new PgKnowledgeStatusRepository(pool),
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
      listEvaluationRuns: (tenantId: string, limit: number) =>
        evaluations.list(tenantId, limit),
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
      conversations: new PgConversationRepository(pool),
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
      workspaceOnboarding: new PgWorkspaceOnboardingRepository(pool),
      chatModels,
      workspaceModelPolicies,
      workspaceMcp: mcpTools
        ? {
            access: new McpAccess(new PgMcpAccessRepository(pool)),
            tools: mcpTools,
            controls: mcpControls,
          }
        : undefined,
      remoteMcp:
        config.MCP_REMOTE_ENABLED && mcpTools
          ? {
              oauth: new McpOAuth(
                new PgMcpOAuthRepository(pool),
                config.MCP_PUBLIC_URL!,
                config.APP_BASE_URL!,
              ),
              tools: mcpTools,
              controls: mcpControls,
            }
          : undefined,
      agentActions: config.AGENT_ACTIONS_ENABLED
        ? new AgentActionService(new PgAgentActionRepository(pool))
        : undefined,
      compareAnswers,
      routeAnswer,
      answerQuestion: defaultChat.answerQuestion,
    },
    close: async () => {
      await workflows?.close();
      await Promise.all([pool.end(), mcpReadPool?.end()]);
    },
  };
}

function createReranker(): Reranker {
  if (config.RERANKER_PROVIDER === "jina") {
    return new JinaReranker(
      config.JINA_BASE_URL,
      config.JINA_API_KEY as string,
      config.JINA_RERANKER_MODEL,
    );
  }
  return new PassThroughReranker();
}

function createAnswerGenerator(
  provider: typeof config.CHAT_PROVIDER,
  model: string,
  maxOutputTokens: number,
): AnswerGenerator {
  switch (provider) {
    case "ollama":
      return new OllamaAnswerGenerator(
        config.OLLAMA_BASE_URL,
        model,
        maxOutputTokens,
      );
    case "openrouter":
      return new OpenRouterAnswerGenerator(
        config.OPENROUTER_BASE_URL,
        config.OPENROUTER_API_KEY as string,
        model,
        maxOutputTokens,
      );
    case "bedrock": {
      const bedrock = createBedrockClient(config.AWS_REGION, 1);
      return new BedrockAnswerGenerator(bedrock, model, maxOutputTokens);
    }
  }
}
