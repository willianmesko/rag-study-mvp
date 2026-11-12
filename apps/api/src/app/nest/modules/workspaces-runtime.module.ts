import { Module } from '@nestjs/common';
import type { CoreRuntime } from '../../composition/core-runtime.js';
import { createWorkspacesRuntime } from '../../composition/workspaces-runtime.js';
import type { RuntimeConfiguration } from '../../configuration/environment.js';
import { CORE_RUNTIME, WORKSPACES_RUNTIME } from '../runtime.tokens.js';
import { RUNTIME_CONFIGURATION } from '../tokens.js';
@Module({ imports: [], providers: [{ provide: WORKSPACES_RUNTIME, useFactory: (config: RuntimeConfiguration, core: CoreRuntime) => createWorkspacesRuntime(config, core), inject: [RUNTIME_CONFIGURATION, CORE_RUNTIME] }], exports: [WORKSPACES_RUNTIME] })
export class WorkspacesRuntimeModule {
}
