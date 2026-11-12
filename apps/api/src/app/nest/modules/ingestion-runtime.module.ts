import { Module } from '@nestjs/common';
import type { AiRuntime } from '../../composition/ai-runtime.js';
import type { CoreRuntime } from '../../composition/core-runtime.js';
import { createIngestionRuntime } from '../../composition/ingestion-runtime.js';
import type { KnowledgeRuntime } from '../../composition/knowledge-runtime.js';
import type { WorkflowsRuntime } from '../../composition/workflows-runtime.js';
import type { RuntimeConfiguration } from '../../configuration/environment.js';
import { AI_RUNTIME, CORE_RUNTIME, INGESTION_RUNTIME, KNOWLEDGE_RUNTIME, WORKFLOWS_RUNTIME } from '../runtime.tokens.js';
import { RUNTIME_CONFIGURATION } from '../tokens.js';
import { AiRuntimeModule } from './ai-runtime.module.js';
import { KnowledgeRuntimeModule } from './knowledge-runtime.module.js';
import { WorkflowsRuntimeModule } from './workflows-runtime.module.js';
@Module({ imports: [AiRuntimeModule, KnowledgeRuntimeModule, WorkflowsRuntimeModule], providers: [{ provide: INGESTION_RUNTIME, useFactory: (config: RuntimeConfiguration, core: CoreRuntime, ai: AiRuntime, knowledge: KnowledgeRuntime, workflows: WorkflowsRuntime) => createIngestionRuntime(config, core, ai, knowledge, workflows), inject: [RUNTIME_CONFIGURATION, CORE_RUNTIME, AI_RUNTIME, KNOWLEDGE_RUNTIME, WORKFLOWS_RUNTIME] }], exports: [INGESTION_RUNTIME] })
export class IngestionRuntimeModule {
}
