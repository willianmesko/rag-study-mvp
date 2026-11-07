import { createHash } from "node:crypto";
import type { ClaimVerifier, EmbeddingProvider, ModelRuntimeProviders } from "../ai/index.js";
import type { UsageMetricsRepository, QuotaRepository } from "../usage/index.js";
import type { SemanticAnswerCache } from "./application/ports/semantic-answer-cache.js";
import type { WorkspaceModelPolicyRepository } from "./application/ports/workspace-model-policy-repository.js";
import type { ChatRuntimeBindings } from "./application/ports/chat-runtime.js";
import type { QuestionAnsweringWorkflowFactory, QuestionAnsweringWorkflowDecorator, QuestionRetriever } from "./application/ports/answer-workflow-factory.js";
import type { ChatExecutionWorkflow } from "./application/ports/chat-execution-workflow.js";
import type { ChatRuntimeOptions } from "./application/ports/chat-runtime-options.js";
import { AnswerQuestionUseCase } from "./application/use-cases/answer-question.js";
import { CompareAnswersUseCase } from "./application/use-cases/compare-answers.js";
import { RouteAnswerUseCase } from "./application/use-cases/route-answer.js";
import { defaultWorkspaceChatPolicy, resolveWorkspaceChatModels } from "./application/policies/workspace-chat-models.js";

export function createChatRuntime(dependencies: {
  embeddings: EmbeddingProvider;
  searchDocuments: QuestionRetriever;
  semanticCache: SemanticAnswerCache;
  usageMetrics: UsageMetricsRepository;
  workspaceModelPolicies: Pick<WorkspaceModelPolicyRepository, "get">;
  workflowFactory: QuestionAnsweringWorkflowFactory;
  tracing: QuestionAnsweringWorkflowDecorator;
  chatExecution: ChatExecutionWorkflow;
  quota: Pick<QuotaRepository, "consumeQuestion">;
  aiProviders: Pick<ModelRuntimeProviders, "createAnswer" | "createClaimVerifier">;
  options: ChatRuntimeOptions;
}) {
  const { embeddings, searchDocuments, semanticCache, usageMetrics, workspaceModelPolicies, workflowFactory, tracing, chatExecution, quota, aiProviders, options } = dependencies;
  const workflowOptions = {
    maxContextChars: 12_000,
    minimumScore: options.minimumScore,
    maxSteps: options.maxSteps,
    timeoutMs: options.timeoutMs,
    requireStructuredOutput: options.requireStructuredOutput,
  };
  const defaultModel = options.defaultModel.model;
  const embeddingModel = options.embeddingIdentity.model;
  const cacheVariant = JSON.stringify([
    "rag-claims-v2",
    options.claimMode,
    options.embeddingIdentity.provider,
    embeddingModel,
    options.rerankerIdentity.provider,
    options.rerankerIdentity.model ?? null,
    options.retrievalTopK,
    options.minimumScore,
    options.requireStructuredOutput,
    options.maxOutputTokens,
  ]);
  const modelConfigs = [
    {
      id: "default",
      label: options.defaultModel.label ?? defaultModel.slice(0, 80),
      model: defaultModel,
      provider: options.defaultModel.provider,
      inputCostPer1kUsd: options.defaultModel.inputCostPer1kUsd,
      outputCostPer1kUsd: options.defaultModel.outputCostPer1kUsd,
    },
    ...options.additionalModels,
  ];
  if (
    new Set(
      modelConfigs.map(
        ({ model, provider }) => `${provider ?? options.defaultModel.provider}:${model}`,
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
        provider = options.defaultModel.provider,
        inputCostPer1kUsd,
        outputCostPer1kUsd,
      }) => {
        const descriptor = { id, label, provider, isDefault: id === "default" };
        const pricing = { inputCostPer1kUsd, outputCostPer1kUsd };
        const generator = aiProviders.createAnswer({ provider, model, ...pricing, checkpointKey: id, maxOutputTokens: options.maxOutputTokens });
        const verifier = aiProviders.createClaimVerifier({ provider, model, ...pricing });
        claimVerifiers.set(id, verifier);
        const workflow = workflowFactory(searchDocuments, generator, {
          ...workflowOptions,
          workflowId: id,
          claimVerifier: verifier,
          claimVerifierFor: (target) =>
            claimVerifiers.get(target.checkpointKey?.split(":")[0] ?? id) ??
            aiProviders.createClaimVerifier(),
        });
        const answerWorkflow = tracing(workflow);
        const answerQuestion = new AnswerQuestionUseCase(
          answerWorkflow,
          embeddings,
          semanticCache,
          usageMetrics,
          {
            cacheTtlSeconds: options.cacheTtlSeconds,
            cacheMinimumSimilarity: options.cacheMinimumSimilarity,
            cacheVariant,
            provider: descriptor.provider,
            model,
            maxOutputTokens: options.maxOutputTokens,
            maxEstimatedCostUsd: options.maxEstimatedCostUsd,
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
      timeoutMs: options.timeoutMs,
      maxOutputTokens: options.maxOutputTokens,
      maxEstimatedCostUsd: options.maxEstimatedCostUsd,
    },
  );
  const routeAnswer = new RouteAnswerUseCase(
    defaultChat.workflow,
    usageMetrics,
    {
      timeoutMs: options.timeoutMs,
      maxOutputTokens: options.maxOutputTokens,
      maxTotalOutputTokens:
        options.autoMaxTotalOutputTokens ??
        options.maxOutputTokens * 2,
      maxTotalInputTokens: options.autoMaxTotalInputTokens,
      maxEstimatedCostUsd: options.maxEstimatedCostUsd,
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
            options.maxOutputTokens,
            options.claimMode,
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
                  tenantLimit: options.tenantDailyQuestionLimit,
                  actorLimit: options.userDailyQuestionLimit,
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
    const maxOutputTokens = Math.min(requestedMaxOutputTokens, options.maxOutputTokens);
    const generator = aiProviders.createAnswer({ provider, model: modelName, inputCostPer1kUsd, outputCostPer1kUsd, checkpointKey: `evaluation:${modelId ?? "default"}:${maxOutputTokens}`, maxOutputTokens });
    return { provider, model: modelName, generator, inputCostPer1kUsd, outputCostPer1kUsd, maxOutputTokens };
  };
  const bindings: ChatRuntimeBindings = {
    chatVersion: chatExecution.version, resolveChat, resolveEvaluationModel,
    consumeQuota: async (tenantId, actorKey) => (await quota.consumeQuestion({ tenantId, actorKey, receiptKey: "primary", tenantLimit: options.tenantDailyQuestionLimit, actorLimit: options.userDailyQuestionLimit })).allowed,
    runChat: chatExecution.execute.bind(chatExecution),
  };
  return { chatModels, defaultChat, compareAnswers, routeAnswer, defaultModel, embeddingModel, bindings };
}
