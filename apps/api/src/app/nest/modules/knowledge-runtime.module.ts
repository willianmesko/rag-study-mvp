import { Module } from '@nestjs/common';
import type { AiRuntime } from '../../composition/ai-runtime.js';
import type { CoreRuntime } from '../../composition/core-runtime.js';
import { createKnowledgeRuntime } from '../../composition/knowledge-runtime.js';
import type { RuntimeConfiguration } from '../../configuration/environment.js';
import { AI_RUNTIME, CORE_RUNTIME, KNOWLEDGE_RUNTIME } from '../runtime.tokens.js';
import { RUNTIME_CONFIGURATION } from '../tokens.js';
import { AiRuntimeModule } from './ai-runtime.module.js';
@Module({ imports: [AiRuntimeModule], providers: [{ provide: KNOWLEDGE_RUNTIME, useFactory: (config: RuntimeConfiguration, core: CoreRuntime, ai: AiRuntime) => createKnowledgeRuntime(config, core, ai), inject: [RUNTIME_CONFIGURATION, CORE_RUNTIME, AI_RUNTIME] }], exports: [KNOWLEDGE_RUNTIME] })
export class KnowledgeRuntimeModule {
}
