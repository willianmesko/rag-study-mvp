import { createChatRuntime as createChatServices } from "../../modules/chat/chat.module.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { AiRuntime } from './ai-runtime.js';
import { chatRuntimeOptionsFromConfiguration, createChatWorkflowBindings } from "./chat-workflows.js";
import type { CoreRuntime } from './core-runtime.js';
import type { KnowledgeRuntime } from './knowledge-runtime.js';
import type { UsageRuntime } from './usage-runtime.js';
export function createChatRuntime(config: RuntimeConfiguration, core: CoreRuntime, ai: AiRuntime, usage: UsageRuntime, knowledge: KnowledgeRuntime) {
    const { chatRuns, semanticCache, workspaceModelPolicies, quotas } = core;
    const { embeddings, modelProviders } = ai;
    const { usageMetrics } = usage;
    const { searchDocuments } = knowledge;
    const { chatModels, defaultChat, compareAnswers, routeAnswer, defaultModel, embeddingModel, bindings: chatBindings } = createChatServices({
        embeddings, searchDocuments, semanticCache, usageMetrics, workspaceModelPolicies,
        ...createChatWorkflowBindings(chatRuns, { enabled: config.LUMORA_LANGSMITH_TRACING, projectName: config.LANGSMITH_PROJECT }),
        quota: quotas, aiProviders: modelProviders, options: chatRuntimeOptionsFromConfiguration(config),
    });
    return { chatModels, defaultChat, compareAnswers, routeAnswer, defaultModel, embeddingModel, chatBindings };
}
export type ChatRuntime = ReturnType<typeof createChatRuntime>;
