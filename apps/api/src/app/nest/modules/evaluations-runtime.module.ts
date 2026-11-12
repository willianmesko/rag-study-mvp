import { Module } from '@nestjs/common';
import type { AiRuntime } from '../../composition/ai-runtime.js';
import type { ChatRuntime } from '../../composition/chat-runtime.js';
import type { CoreRuntime } from '../../composition/core-runtime.js';
import { createEvaluationsRuntime } from '../../composition/evaluations-runtime.js';
import type { KnowledgeRuntime } from '../../composition/knowledge-runtime.js';
import type { RuntimeConfiguration } from '../../configuration/environment.js';
import { AI_RUNTIME, CHAT_RUNTIME, CORE_RUNTIME, EVALUATIONS_RUNTIME, KNOWLEDGE_RUNTIME } from '../runtime.tokens.js';
import { RUNTIME_CONFIGURATION } from '../tokens.js';
import { AiRuntimeModule } from './ai-runtime.module.js';
import { ChatRuntimeModule } from './chat-runtime.module.js';
import { KnowledgeRuntimeModule } from './knowledge-runtime.module.js';
@Module({ imports: [AiRuntimeModule, KnowledgeRuntimeModule, ChatRuntimeModule], providers: [{ provide: EVALUATIONS_RUNTIME, useFactory: (config: RuntimeConfiguration, core: CoreRuntime, ai: AiRuntime, knowledge: KnowledgeRuntime, chat: ChatRuntime) => createEvaluationsRuntime(config, core, ai, knowledge, chat), inject: [RUNTIME_CONFIGURATION, CORE_RUNTIME, AI_RUNTIME, KNOWLEDGE_RUNTIME, CHAT_RUNTIME] }], exports: [EVALUATIONS_RUNTIME] })
export class EvaluationsRuntimeModule {
}
