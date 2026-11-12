import { Module } from '@nestjs/common';
import type { CoreRuntime } from '../../composition/core-runtime.js';
import { createUsageRuntime } from '../../composition/usage-runtime.js';
import type { RuntimeConfiguration } from '../../configuration/environment.js';
import { CORE_RUNTIME, USAGE_RUNTIME } from '../runtime.tokens.js';
import { RUNTIME_CONFIGURATION } from '../tokens.js';
@Module({ imports: [], providers: [{ provide: USAGE_RUNTIME, useFactory: (config: RuntimeConfiguration, core: CoreRuntime) => createUsageRuntime(config, core), inject: [RUNTIME_CONFIGURATION, CORE_RUNTIME] }], exports: [USAGE_RUNTIME] })
export class UsageRuntimeModule {
}
