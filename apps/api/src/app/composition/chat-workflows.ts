import type { QuestionAnsweringWorkflowFactory, QuestionAnsweringWorkflowDecorator } from "../../modules/chat/application/ports/answer-workflow-factory.js";
import type { ChatRuntimeOptions } from "../../modules/chat/application/ports/chat-runtime-options.js";
import type { config } from "../../config.js";
import type { ChatExecutionWorkflow } from "../../modules/chat/application/ports/chat-execution-workflow.js";
import type { ChatRunRepository } from "../../modules/chat/application/ports/chat-run-repository.js";
import { LangGraphRagWorkflow } from "../../modules/chat/infrastructure/langgraph/langgraph-rag-workflow.js";
import { LangGraphChatWorkflow, chatWorkflowVersion } from "../../modules/chat/infrastructure/langgraph/langgraph-chat-workflow.js";
import { LangSmithTracingWorkflow } from "../../modules/chat/infrastructure/langsmith/langsmith-tracing-workflow.js";

/** Translate deployment-specific names into product options at the root only. */
export function chatRuntimeOptionsFromConfiguration(configuration: typeof config): ChatRuntimeOptions {
  const model = {
    ollama: configuration.OLLAMA_CHAT_MODEL,
    openrouter: configuration.OPENROUTER_CHAT_MODEL,
    bedrock: configuration.BEDROCK_CHAT_MODEL_ID,
  }[configuration.CHAT_PROVIDER];
  const embeddingModel = {
    ollama: configuration.OLLAMA_EMBEDDING_MODEL,
    openrouter: configuration.OPENROUTER_EMBEDDING_MODEL,
    bedrock: configuration.BEDROCK_EMBEDDING_MODEL_ID,
  }[configuration.EMBEDDING_PROVIDER];
  return {
    defaultModel: {
      provider: configuration.CHAT_PROVIDER,
      model,
      label: configuration.CHAT_DEFAULT_MODEL_LABEL,
      inputCostPer1kUsd: configuration.ESTIMATED_INPUT_COST_PER_1K_USD,
      outputCostPer1kUsd: configuration.ESTIMATED_OUTPUT_COST_PER_1K_USD,
    },
    additionalModels: configuration.CHAT_ADDITIONAL_MODELS,
    embeddingIdentity: { provider: configuration.EMBEDDING_PROVIDER, model: embeddingModel },
    rerankerIdentity: {
      provider: configuration.RERANKER_PROVIDER,
      model: configuration.RERANKER_PROVIDER === "jina" ? configuration.JINA_RERANKER_MODEL : undefined,
    },
    claimMode: configuration.RAG_CLAIM_MODE,
    minimumScore: configuration.RAG_MINIMUM_SCORE,
    maxSteps: configuration.AGENT_MAX_STEPS,
    timeoutMs: configuration.AGENT_TIMEOUT_MS,
    requireStructuredOutput: configuration.REQUIRE_STRUCTURED_ANSWER,
    retrievalTopK: configuration.RETRIEVAL_TOP_K,
    maxOutputTokens: configuration.CHAT_MAX_OUTPUT_TOKENS,
    maxEstimatedCostUsd: configuration.MAX_ESTIMATED_COST_USD_PER_REQUEST,
    autoMaxTotalInputTokens: configuration.CHAT_AUTO_MAX_TOTAL_INPUT_TOKENS,
    autoMaxTotalOutputTokens: configuration.CHAT_AUTO_MAX_TOTAL_OUTPUT_TOKENS,
    cacheTtlSeconds: configuration.SEMANTIC_CACHE_TTL_SECONDS,
    cacheMinimumSimilarity: configuration.SEMANTIC_CACHE_MINIMUM_SIMILARITY,
    tenantDailyQuestionLimit: configuration.DAILY_TENANT_QA_LIMIT,
    userDailyQuestionLimit: configuration.DAILY_USER_QA_LIMIT,
  };
}

export function createChatWorkflowBindings(runs: ChatRunRepository, tracing: {
  enabled: boolean;
  projectName: string;
}): {
  workflowFactory: QuestionAnsweringWorkflowFactory;
  tracing: QuestionAnsweringWorkflowDecorator;
  chatExecution: ChatExecutionWorkflow;
} {
  const chat = new LangGraphChatWorkflow(runs);
  return {
    workflowFactory: (retriever, generator, options) => new LangGraphRagWorkflow(retriever, generator, options),
    tracing: (workflow) => new LangSmithTracingWorkflow(workflow, tracing),
    chatExecution: { version: chatWorkflowVersion, execute: chat.execute.bind(chat) },
  };
}
