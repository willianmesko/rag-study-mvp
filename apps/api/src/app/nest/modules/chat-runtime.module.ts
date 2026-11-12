import { Module } from '@nestjs/common';
import type { AiRuntime } from '../../composition/ai-runtime.js';
import { createChatRuntime } from '../../composition/chat-runtime.js';
import type { CoreRuntime } from '../../composition/core-runtime.js';
import type { KnowledgeRuntime } from '../../composition/knowledge-runtime.js';
import type { UsageRuntime } from '../../composition/usage-runtime.js';
import type { RuntimeConfiguration } from '../../configuration/environment.js';
import { AI_RUNTIME, CHAT_RUNTIME, CORE_RUNTIME, KNOWLEDGE_RUNTIME, USAGE_RUNTIME } from '../runtime.tokens.js';
import { RUNTIME_CONFIGURATION } from '../tokens.js';
import { AiRuntimeModule } from './ai-runtime.module.js';
import { KnowledgeRuntimeModule } from './knowledge-runtime.module.js';
import { UsageRuntimeModule } from './usage-runtime.module.js';
@Module({ imports: [AiRuntimeModule, UsageRuntimeModule, KnowledgeRuntimeModule], providers: [{ provide: CHAT_RUNTIME, useFactory: (config: RuntimeConfiguration, core: CoreRuntime, ai: AiRuntime, usage: UsageRuntime, knowledge: KnowledgeRuntime) => createChatRuntime(config, core, ai, usage, knowledge), inject: [RUNTIME_CONFIGURATION, CORE_RUNTIME, AI_RUNTIME, USAGE_RUNTIME, KNOWLEDGE_RUNTIME] }], exports: [CHAT_RUNTIME] })
export class ChatRuntimeModule {
}
