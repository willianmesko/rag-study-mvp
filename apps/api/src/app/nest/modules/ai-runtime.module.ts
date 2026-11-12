import { Module } from '@nestjs/common';
import { createAiRuntime } from '../../composition/ai-runtime.js';
import type { CoreRuntime } from '../../composition/core-runtime.js';
import type { UsageRuntime } from '../../composition/usage-runtime.js';
import type { RuntimeConfiguration } from '../../configuration/environment.js';
import { AI_RUNTIME, CORE_RUNTIME, USAGE_RUNTIME } from '../runtime.tokens.js';
import { RUNTIME_CONFIGURATION } from '../tokens.js';
import { UsageRuntimeModule } from './usage-runtime.module.js';
@Module({ imports: [UsageRuntimeModule], providers: [{ provide: AI_RUNTIME, useFactory: (config: RuntimeConfiguration, core: CoreRuntime, usage: UsageRuntime) => createAiRuntime(config, core, usage), inject: [RUNTIME_CONFIGURATION, CORE_RUNTIME, USAGE_RUNTIME] }], exports: [AI_RUNTIME] })
export class AiRuntimeModule {
}
