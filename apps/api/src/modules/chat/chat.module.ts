import type { config } from "../../config.js";
import { createHash } from "node:crypto";
import type { ClaimVerifier, EmbeddingProvider, ModelRuntimeProviders } from "../ai/index.js";
import type { SearchDocumentsUseCase } from "../knowledge/index.js";
import type { UsageMetricsRepository, QuotaRepository } from "../usage/index.js";
import type { SemanticAnswerCache } from "./application/ports/semantic-answer-cache.js";
import type { WorkspaceModelPolicyRepository } from "./application/ports/workspace-model-policy-repository.js";
import type { ChatRunRepository } from "./application/ports/chat-run-repository.js";
import type { ChatRuntimeBindings } from "./application/ports/chat-runtime.js";
import { AnswerQuestionUseCase } from "./application/use-cases/answer-question.js";
import { CompareAnswersUseCase } from "./application/use-cases/compare-answers.js";
import { RouteAnswerUseCase } from "./application/use-cases/route-answer.js";
import { LangGraphRagWorkflow } from "./infrastructure/langgraph/langgraph-rag-workflow.js";
import { LangSmithTracingWorkflow } from "./infrastructure/langsmith/langsmith-tracing-workflow.js";
import { LangGraphChatWorkflow, chatWorkflowVersion } from "./infrastructure/langgraph/langgraph-chat-workflow.js";
import { defaultWorkspaceChatPolicy, resolveWorkspaceChatModels } from "./application/policies/workspace-chat-models.js";
import type { Pool } from "pg";
import { PgChatRunRepository } from "./infrastructure/postgres/pg-chat-run-repository.js";
import { PgConversationRepository } from "./infrastructure/postgres/pg-conversation-repository.js";
import { PgSemanticAnswerCache } from "./infrastructure/postgres/pg-semantic-answer-cache.js";
import { PgWorkspaceModelPolicyRepository } from "./infrastructure/postgres/pg-workspace-model-policy-repository.js";

/** Chat providers share the root pool; lifecycle remains with the application. */
export function createChatStorage(pool: Pool, embeddingDimensions: number) {
  return {
    chatRuns: new PgChatRunRepository(pool),
    conversations: new PgConversationRepository(pool),
    semanticCache: new PgSemanticAnswerCache(pool, embeddingDimensions),
    workspaceModelPolicies: new PgWorkspaceModelPolicyRepository(pool),
  };
}

type ChatRuntimeConfiguration = Pick<typeof config, "AGENT_MAX_STEPS" | "AGENT_TIMEOUT_MS" | "BEDROCK_CHAT_MODEL_ID" | "BEDROCK_EMBEDDING_MODEL_ID" | "CHAT_ADDITIONAL_MODELS" | "CHAT_AUTO_MAX_TOTAL_INPUT_TOKENS" | "CHAT_AUTO_MAX_TOTAL_OUTPUT_TOKENS" | "CHAT_DEFAULT_MODEL_LABEL" | "CHAT_MAX_OUTPUT_TOKENS" | "CHAT_PROVIDER" | "DAILY_TENANT_QA_LIMIT" | "DAILY_USER_QA_LIMIT" | "EMBEDDING_PROVIDER" | "ESTIMATED_INPUT_COST_PER_1K_USD" | "ESTIMATED_OUTPUT_COST_PER_1K_USD" | "JINA_RERANKER_MODEL" | "LANGSMITH_PROJECT" | "LANGSMITH_TRACING" | "MAX_ESTIMATED_COST_USD_PER_REQUEST" | "OLLAMA_CHAT_MODEL" | "OLLAMA_EMBEDDING_MODEL" | "OPENROUTER_CHAT_MODEL" | "OPENROUTER_EMBEDDING_MODEL" | "RAG_CLAIM_MODE" | "RAG_MINIMUM_SCORE" | "REQUIRE_STRUCTURED_ANSWER" | "RERANKER_PROVIDER" | "RETRIEVAL_TOP_K" | "SEMANTIC_CACHE_MINIMUM_SIMILARITY" | "SEMANTIC_CACHE_TTL_SECONDS">;

export function createChatRuntime(dependencies: {
  embeddings: EmbeddingProvider;
  searchDocuments: SearchDocumentsUseCase;
  semanticCache: SemanticAnswerCache;
  usageMetrics: UsageMetricsRepository;
  workspaceModelPolicies: Pick<WorkspaceModelPolicyRepository, "get">;
  chatRuns: ChatRunRepository;
  quota: Pick<QuotaRepository, "consumeQuestion">;
  aiProviders: Pick<ModelRuntimeProviders, "createAnswer" | "createClaimVerifier">;
  configuration: ChatRuntimeConfiguration;
}) {
  const { embeddings, searchDocuments, semanticCache, usageMetrics, workspaceModelPolicies, chatRuns, quota, aiProviders, configuration } = dependencies;
  const workflowOptions = {
    maxContextChars: 12_000,
    minimumScore: configuration.RAG_MINIMUM_SCORE,
    maxSteps: configuration.AGENT_MAX_STEPS,
    timeoutMs: configuration.AGENT_TIMEOUT_MS,
    requireStructuredOutput: configuration.REQUIRE_STRUCTURED_ANSWER,
  };
  const defaultModel = {
    ollama: configuration.OLLAMA_CHAT_MODEL,
    openrouter: configuration.OPENROUTER_CHAT_MODEL,
    bedrock: configuration.BEDROCK_CHAT_MODEL_ID,
  }[configuration.CHAT_PROVIDER];
  const embeddingModel = {
    ollama: configuration.OLLAMA_EMBEDDING_MODEL,
    openrouter: configuration.OPENROUTER_EMBEDDING_MODEL,
    bedrock: configuration.BEDROCK_EMBEDDING_MODEL_ID,
  }[configuration.EMBEDDING_PROVIDER];
  const cacheVariant = JSON.stringify([
    "rag-claims-v2",
    configuration.RAG_CLAIM_MODE,
    configuration.EMBEDDING_PROVIDER,
    embeddingModel,
    configuration.RERANKER_PROVIDER,
    configuration.RERANKER_PROVIDER === "jina" ? configuration.JINA_RERANKER_MODEL : null,
    configuration.RETRIEVAL_TOP_K,
    configuration.RAG_MINIMUM_SCORE,
    configuration.REQUIRE_STRUCTURED_ANSWER,
    configuration.CHAT_MAX_OUTPUT_TOKENS,
  ]);
  const modelConfigs = [
    {
      id: "default",
      label: configuration.CHAT_DEFAULT_MODEL_LABEL ?? defaultModel.slice(0, 80),
      model: defaultModel,
      provider: configuration.CHAT_PROVIDER,
      inputCostPer1kUsd: configuration.ESTIMATED_INPUT_COST_PER_1K_USD,
      outputCostPer1kUsd: configuration.ESTIMATED_OUTPUT_COST_PER_1K_USD,
    },
    ...configuration.CHAT_ADDITIONAL_MODELS,
  ];
  if (
    new Set(
      modelConfigs.map(
        ({ model, provider }) => `${provider ?? configuration.CHAT_PROVIDER}:${model}`,
      ),
    ).size !== modelConfigs.length
  ) {
    throw new Error(
      "Chat model IDs must be distinct, including the default model.",
    );
  }
  const claimVerifiers = new Map<string, ClaimVerifier>();
  const chatModels = new Map(
    modelConfigs.map(
      ({
        id,
        label,
        model,
        provider = configuration.CHAT_PROVIDER,
        inputCostPer1kUsd,
        outputCostPer1kUsd,
      }) => {
        const descriptor = { id, label, provider, isDefault: id === "default" };
        const pricing = { inputCostPer1kUsd, outputCostPer1kUsd };
        const generator = aiProviders.createAnswer({ provider, model, ...pricing, checkpointKey: id, maxOutputTokens: configuration.CHAT_MAX_OUTPUT_TOKENS });
        const verifier = aiProviders.createClaimVerifier({ provider, model, ...pricing });
        claimVerifiers.set(id, verifier);
        const workflow = new LangGraphRagWorkflow(searchDocuments, generator, {
          ...workflowOptions,
          workflowId: id,
          claimVerifier: verifier,
          claimVerifierFor: (target) =>
            claimVerifiers.get(target.checkpointKey?.split(":")[0] ?? id) ??
            aiProviders.createClaimVerifier(),
        });
        const answerWorkflow = new LangSmithTracingWorkflow(workflow, {
          enabled: configuration.LANGSMITH_TRACING,
          projectName: configuration.LANGSMITH_PROJECT,
        });
        const answerQuestion = new AnswerQuestionUseCase(
          answerWorkflow,
          embeddings,
          semanticCache,
          usageMetrics,
          {
            cacheTtlSeconds: configuration.SEMANTIC_CACHE_TTL_SECONDS,
            cacheMinimumSimilarity: configuration.SEMANTIC_CACHE_MINIMUM_SIMILARITY,
            cacheVariant,
            provider: descriptor.provider,
            model,
            maxOutputTokens: configuration.CHAT_MAX_OUTPUT_TOKENS,
            maxEstimatedCostUsd: configuration.MAX_ESTIMATED_COST_USD_PER_REQUEST,
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
  const compareAnswers = new CompareAnswersUseCase(
    defaultChat.workflow,
    usageMetrics,
    {
      timeoutMs: configuration.AGENT_TIMEOUT_MS,
      maxOutputTokens: configuration.CHAT_MAX_OUTPUT_TOKENS,
      maxEstimatedCostUsd: configuration.MAX_ESTIMATED_COST_USD_PER_REQUEST,
    },
  );
  const routeAnswer = new RouteAnswerUseCase(
    defaultChat.workflow,
    usageMetrics,
    {
      timeoutMs: configuration.AGENT_TIMEOUT_MS,
      maxOutputTokens: configuration.CHAT_MAX_OUTPUT_TOKENS,
      maxTotalOutputTokens:
        configuration.CHAT_AUTO_MAX_TOTAL_OUTPUT_TOKENS ??
        configuration.CHAT_MAX_OUTPUT_TOKENS * 2,
      maxTotalInputTokens: configuration.CHAT_AUTO_MAX_TOTAL_INPUT_TOKENS,
      maxEstimatedCostUsd: configuration.MAX_ESTIMATED_COST_USD_PER_REQUEST,
    },
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
            configuration.CHAT_MAX_OUTPUT_TOKENS,
            configuration.RAG_CLAIM_MODE,
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
                await quota.consumeQuestion({
                  tenantId: input.tenantId,
                  actorKey: input.actorKey,
                  receiptKey: `fallback:${id}`,
                  tenantLimit: configuration.DAILY_TENANT_QA_LIMIT,
                  actorLimit: configuration.DAILY_USER_QA_LIMIT,
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
  const resolveEvaluationModel: ChatRuntimeBindings["resolveEvaluationModel"] = async (tenantId, modelId, requestedMaxOutputTokens) => {
    const policy = (await workspaceModelPolicies.get(tenantId)) ?? defaultWorkspaceChatPolicy(chatModels);
    const profile = resolveWorkspaceChatModels(chatModels, policy);
    const model = profile.models.get(modelId ?? profile.defaultModelId ?? "");
    if (!model) return undefined;
    const { descriptor: { provider }, model: modelName, inputCostPer1kUsd, outputCostPer1kUsd } = model;
    const maxOutputTokens = Math.min(requestedMaxOutputTokens, configuration.CHAT_MAX_OUTPUT_TOKENS);
    const generator = aiProviders.createAnswer({ provider, model: modelName, inputCostPer1kUsd, outputCostPer1kUsd, checkpointKey: `evaluation:${modelId ?? "default"}:${maxOutputTokens}`, maxOutputTokens });
    return { provider, model: modelName, generator, inputCostPer1kUsd, outputCostPer1kUsd, maxOutputTokens };
  };
  const chatGraph = new LangGraphChatWorkflow(chatRuns);
  const bindings: ChatRuntimeBindings = {
    chatVersion: chatWorkflowVersion, resolveChat, resolveEvaluationModel,
    consumeQuota: async (tenantId, actorKey) => (await quota.consumeQuestion({ tenantId, actorKey, receiptKey: "primary", tenantLimit: configuration.DAILY_TENANT_QA_LIMIT, actorLimit: configuration.DAILY_USER_QA_LIMIT })).allowed,
    runChat: chatGraph.execute.bind(chatGraph),
  };
  return { chatModels, defaultChat, compareAnswers, routeAnswer, defaultModel, embeddingModel, bindings };
}
