import { Global, Module } from '@nestjs/common';
import type { WorkspaceModelPolicyRepository } from '../../../modules/chat/application/ports/workspace-model-policy-repository.js';
import { createCoreRuntime } from '../../composition/core-runtime.js';
import type { RuntimeConfiguration } from '../../configuration/environment.js';
import { PilotPersistenceModule } from '../persistence.module.js';
import { CORE_RUNTIME } from '../runtime.tokens.js';
import { WORKSPACE_MODEL_POLICIES } from '../tokens.js';
@Global()
@Module({})
export class CoreRuntimeModule {
    static register(configuration: RuntimeConfiguration) { return { module: CoreRuntimeModule, imports: [PilotPersistenceModule.register(configuration)], providers: [{ provide: CORE_RUNTIME, useFactory: (workspaceModelPolicies: WorkspaceModelPolicyRepository) => createCoreRuntime(configuration, { workspaceModelPolicies }), inject: [WORKSPACE_MODEL_POLICIES] }], exports: [CORE_RUNTIME] }; }
}
