import type { config } from "../../config.js";
import type { AnswerGenerator, AnswerProviderInput, EmbeddingModelIdentity, EmbeddingProvider, ModelProviderRegistry, ModelRuntimeGuards, ModelRuntimeOptions, Reranker } from "../../modules/ai/index.js";
import type { FaithfulnessJudge } from "../../modules/evaluations/index.js";
import { BedrockAnswerGenerator } from "../../modules/ai/infrastructure/bedrock/bedrock-answer-generator.js";
import { TitanEmbeddingProvider } from "../../modules/ai/infrastructure/bedrock/titan-embedding-provider.js";
import { OllamaAnswerGenerator } from "../../modules/ai/infrastructure/ollama/ollama-answer-generator.js";
import { OllamaEmbeddingProvider } from "../../modules/ai/infrastructure/ollama/ollama-embedding-provider.js";
import { OpenRouterAnswerGenerator } from "../../modules/ai/infrastructure/openrouter/openrouter-answer-generator.js";
import { OpenRouterEmbeddingProvider } from "../../modules/ai/infrastructure/openrouter/openrouter-embedding-provider.js";
import { OpenRouterFaithfulnessJudge } from "../../modules/ai/infrastructure/openrouter/openrouter-faithfulness-judge.js";
import { JinaReranker } from "../../modules/ai/infrastructure/jina/jina-reranker.js";
import { PassThroughReranker } from "../../modules/ai/infrastructure/reranking/pass-through-reranker.js";
import { WorkflowAnswerGenerator, WorkflowFaithfulnessJudge } from "../../modules/ai/infrastructure/security/workflow-provider-guards.js";
import { createBedrockClient } from "../../platform/ai/bedrock-client.js";

export type ModelProviderRegistration = {
  readonly id: string;
  readonly createAnswer?: (input: Omit<AnswerProviderInput, "provider">) => AnswerGenerator;
  readonly createEmbedding?: (identity: EmbeddingModelIdentity) => EmbeddingProvider;
  readonly createJudge?: (model: string) => FaithfulnessJudge;
};

/** Only backend composition can register factories; consumers receive no mutation API. */
export function createProviderRegistry(registrations: readonly ModelProviderRegistration[], reranker: () => Reranker): ModelProviderRegistry {
  const providers = new Map<string, ModelProviderRegistration>();
  for (const registration of registrations) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(registration.id) || providers.has(registration.id)) {
      throw new Error("Provider registrations require unique, valid backend identities.");
    }
    providers.set(registration.id, Object.freeze({ ...registration }));
  }
  const registered = (provider: string) => {
    const registration = providers.get(provider);
    if (!registration) throw new Error("The model provider is not registered by the backend.");
    return registration;
  };
  return Object.freeze({
    createAnswer({ provider, model, maxOutputTokens }: AnswerProviderInput) {
      const factory = registered(provider).createAnswer;
      if (!factory) throw new Error("The registered provider does not support answer generation.");
      return factory({ model, maxOutputTokens });
    },
    createEmbedding(identity: EmbeddingModelIdentity) {
      const factory = registered(identity.provider).createEmbedding;
      if (!factory) throw new Error("The registered provider does not support embeddings.");
      return factory(identity);
    },
    createJudge(input: Pick<AnswerProviderInput, "provider" | "model">) {
      return registered(input.provider).createJudge?.(input.model);
    },
    createReranker: reranker,
  });
}

type ProviderConfiguration = Pick<typeof config,
  "OLLAMA_BASE_URL" | "OLLAMA_EMBEDDING_MODEL" | "OPENROUTER_BASE_URL" | "OPENROUTER_API_KEY" |
  "OPENROUTER_EMBEDDING_MODEL" | "AWS_REGION" | "BEDROCK_EMBEDDING_MODEL_ID" | "EMBEDDING_PROVIDER" |
  "EMBEDDING_DIMENSIONS" | "RERANKER_PROVIDER" | "JINA_BASE_URL" | "JINA_API_KEY" | "JINA_RERANKER_MODEL" |
  "RAG_CLAIM_MODE" | "EVAL_FAITHFULNESS_JUDGE_MODEL" | "EVAL_JUDGE_INPUT_COST_PER_1K_USD" | "EVAL_JUDGE_OUTPUT_COST_PER_1K_USD">;

export function defaultWorkspaceEmbeddingModel(configuration: Pick<ProviderConfiguration,
  "EMBEDDING_PROVIDER" | "EMBEDDING_DIMENSIONS" | "OLLAMA_EMBEDDING_MODEL" | "OPENROUTER_EMBEDDING_MODEL" | "BEDROCK_EMBEDDING_MODEL_ID">): EmbeddingModelIdentity {
  const model = {
    ollama: configuration.OLLAMA_EMBEDDING_MODEL,
    openrouter: configuration.OPENROUTER_EMBEDDING_MODEL,
    bedrock: configuration.BEDROCK_EMBEDDING_MODEL_ID,
  }[configuration.EMBEDDING_PROVIDER];
  return { provider: configuration.EMBEDDING_PROVIDER, model, dimensions: configuration.EMBEDDING_DIMENSIONS };
}

export function createWorkflowModelGuards(): ModelRuntimeGuards {
  return Object.freeze({
    answer: (inner, input) => new WorkflowAnswerGenerator(inner, input.checkpointKey, {
      inputCostPer1kUsd: input.inputCostPer1kUsd, outputCostPer1kUsd: input.outputCostPer1kUsd,
    }, input.maxOutputTokens),
    judge: (inner, pricing) => new WorkflowFaithfulnessJudge(inner, pricing),
  } satisfies ModelRuntimeGuards);
}

/** Vendor selection, credentials and SDK lifetime are application-level decisions. */
export function createConfiguredProviderBindings(configuration: ProviderConfiguration): {
  registry: ModelProviderRegistry;
  guards: ModelRuntimeGuards;
  options: ModelRuntimeOptions;
  defaultEmbedding: EmbeddingModelIdentity;
} {
  let embeddingBedrockClient: ReturnType<typeof createBedrockClient> | undefined;
  const registry = createProviderRegistry([
    {
      id: "ollama",
      createAnswer: ({ model, maxOutputTokens }) => new OllamaAnswerGenerator(configuration.OLLAMA_BASE_URL, model, maxOutputTokens),
      createEmbedding: ({ model, dimensions }) => new OllamaEmbeddingProvider(configuration.OLLAMA_BASE_URL, model, dimensions),
    },
    {
      id: "openrouter",
      createAnswer: ({ model, maxOutputTokens }) => new OpenRouterAnswerGenerator(configuration.OPENROUTER_BASE_URL, configuration.OPENROUTER_API_KEY!, model, maxOutputTokens),
      createEmbedding: ({ model, dimensions }) => {
        if (!configuration.OPENROUTER_API_KEY) throw new Error("The workspace embedding index requires an OpenRouter API key.");
        return new OpenRouterEmbeddingProvider(configuration.OPENROUTER_BASE_URL, configuration.OPENROUTER_API_KEY, model, dimensions);
      },
      createJudge: (model) => new OpenRouterFaithfulnessJudge(configuration.OPENROUTER_BASE_URL, configuration.OPENROUTER_API_KEY!, model),
    },
    {
      id: "bedrock",
      createAnswer: ({ model, maxOutputTokens }) => new BedrockAnswerGenerator(createBedrockClient(configuration.AWS_REGION, 1), model, maxOutputTokens),
      createEmbedding: ({ model, dimensions }) => {
        embeddingBedrockClient ??= createBedrockClient(configuration.AWS_REGION);
        return new TitanEmbeddingProvider(embeddingBedrockClient, model, dimensions);
      },
    },
  ], () => configuration.RERANKER_PROVIDER === "jina"
    ? new JinaReranker(configuration.JINA_BASE_URL, configuration.JINA_API_KEY!, configuration.JINA_RERANKER_MODEL)
    : new PassThroughReranker());
  return {
    registry,
    guards: createWorkflowModelGuards(),
    options: {
      claimMode: configuration.RAG_CLAIM_MODE,
      evaluationJudge: configuration.EVAL_FAITHFULNESS_JUDGE_MODEL ? {
        provider: "openrouter", model: configuration.EVAL_FAITHFULNESS_JUDGE_MODEL,
        inputCostPer1kUsd: configuration.EVAL_JUDGE_INPUT_COST_PER_1K_USD,
        outputCostPer1kUsd: configuration.EVAL_JUDGE_OUTPUT_COST_PER_1K_USD,
      } : undefined,
    },
    defaultEmbedding: defaultWorkspaceEmbeddingModel(configuration),
  };
}
