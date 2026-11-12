import { resolveWorkspaceEmbeddingIndex } from "../../modules/ai/application/ports/embedding-provider.js";
import { createWorkspaceWorkflowServices } from "../../modules/workflows/workflows.module.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { AiRuntime } from './ai-runtime.js';
import type { ChatRuntime } from './chat-runtime.js';
import type { CoreRuntime } from './core-runtime.js';
import type { EvaluationsRuntime } from './evaluations-runtime.js';
import { workspaceWorkflowOptionsFromConfiguration } from "./workflow-runtime.js";
import type { WorkspacesRuntime } from './workspaces-runtime.js';
export function createWorkflowsRuntime(config: RuntimeConfiguration, core: CoreRuntime, ai: AiRuntime, workspaces: WorkspacesRuntime, chat: ChatRuntime, evaluations: EvaluationsRuntime) {
    const { engine } = core;
    const { embeddings } = ai;
    const { memberships } = workspaces;
    const { chatBindings } = chat;
    const { runEvaluation, evaluationVersion } = evaluations;
    const embeddingVersion = async (tenantId: string) => (await resolveWorkspaceEmbeddingIndex(embeddings, tenantId)).version ??
        "legacy-default";
    const workflows = createWorkspaceWorkflowServices({
        engine, chat: chatBindings, runEvaluation, evaluationVersion,
        member: memberships.findByUserAndTenant.bind(memberships), embeddingVersion,
        options: workspaceWorkflowOptionsFromConfiguration(config),
    });
    return { embeddingVersion, workflows };
}
export type WorkflowsRuntime = ReturnType<typeof createWorkflowsRuntime>;
