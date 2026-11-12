import { Module } from '@nestjs/common';
import type { AiRuntime } from '../../composition/ai-runtime.js';
import type { ChatRuntime } from '../../composition/chat-runtime.js';
import type { CoreRuntime } from '../../composition/core-runtime.js';
import type { EvaluationsRuntime } from '../../composition/evaluations-runtime.js';
import { createWorkflowsRuntime } from '../../composition/workflows-runtime.js';
import type { WorkspacesRuntime } from '../../composition/workspaces-runtime.js';
import type { RuntimeConfiguration } from '../../configuration/environment.js';
import { AI_RUNTIME, CHAT_RUNTIME, CORE_RUNTIME, EVALUATIONS_RUNTIME, WORKFLOWS_RUNTIME, WORKSPACES_RUNTIME } from '../runtime.tokens.js';
import { RUNTIME_CONFIGURATION } from '../tokens.js';
import { AiRuntimeModule } from './ai-runtime.module.js';
import { ChatRuntimeModule } from './chat-runtime.module.js';
import { EvaluationsRuntimeModule } from './evaluations-runtime.module.js';
import { WorkspacesRuntimeModule } from './workspaces-runtime.module.js';
@Module({ imports: [AiRuntimeModule, WorkspacesRuntimeModule, ChatRuntimeModule, EvaluationsRuntimeModule], providers: [{ provide: WORKFLOWS_RUNTIME, useFactory: (config: RuntimeConfiguration, core: CoreRuntime, ai: AiRuntime, workspaces: WorkspacesRuntime, chat: ChatRuntime, evaluations: EvaluationsRuntime) => createWorkflowsRuntime(config, core, ai, workspaces, chat, evaluations), inject: [RUNTIME_CONFIGURATION, CORE_RUNTIME, AI_RUNTIME, WORKSPACES_RUNTIME, CHAT_RUNTIME, EVALUATIONS_RUNTIME] }], exports: [WORKFLOWS_RUNTIME] })
export class WorkflowsRuntimeModule {
}
