import type { WorkspaceModelPolicyRepository } from '../modules/chat/application/ports/workspace-model-policy-repository.js';
import { createAiRuntime } from './composition/ai-runtime.js';
import { assembleApplicationRuntime } from './composition/application-runtime.js';
import { createChatRuntime } from './composition/chat-runtime.js';
import { createCoreRuntime } from './composition/core-runtime.js';
import { createEvaluationsRuntime } from './composition/evaluations-runtime.js';
import { createIngestionRuntime } from './composition/ingestion-runtime.js';
import { createKnowledgeRuntime } from './composition/knowledge-runtime.js';
import { createMcpRuntime } from './composition/mcp-runtime.js';
import { createUsageRuntime } from './composition/usage-runtime.js';
import { createWorkflowsRuntime } from './composition/workflows-runtime.js';
import { createWorkspacesRuntime } from './composition/workspaces-runtime.js';
import type { RuntimeConfiguration } from './configuration/environment.js';
/** Standalone CLI composition; the API obtains these same factories from Nest DI. */
export function createApplication(config: RuntimeConfiguration, overrides: {
    workspaceModelPolicies?: WorkspaceModelPolicyRepository;
} = {}) {
    const core = createCoreRuntime(config, overrides);
    const usage = createUsageRuntime(config, core);
    const workspaces = createWorkspacesRuntime(config, core);
    const ai = createAiRuntime(config, core, usage);
    const knowledge = createKnowledgeRuntime(config, core, ai);
    const chat = createChatRuntime(config, core, ai, usage, knowledge);
    const evaluations = createEvaluationsRuntime(config, core, ai, knowledge, chat);
    const workflows = createWorkflowsRuntime(config, core, ai, workspaces, chat, evaluations);
    const ingestion = createIngestionRuntime(config, core, ai, knowledge, workflows);
    const mcp = createMcpRuntime(config, core, ai);
    return assembleApplicationRuntime(config, core, usage, workspaces, ai, knowledge, chat, evaluations, workflows, ingestion, mcp);
}
