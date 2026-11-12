import { Global, Module } from "@nestjs/common";
import type { WorkspaceModelPolicyRepository } from "../../../modules/chat/application/ports/workspace-model-policy-repository.js";
import type { AuditEventRepository } from "../../../modules/usage/application/ports/audit-event-repository.js";
import { createCoreRuntime } from "../../composition/core-runtime.js";
import type { RuntimeConfiguration } from "../../configuration/environment.js";
import { PilotPersistenceModule } from "../persistence.module.js";
import { CORE_RUNTIME } from "../runtime.tokens.js";
import { AUDIT_EVENTS, WORKSPACE_MODEL_POLICIES } from "../tokens.js";

@Global()
@Module({})
export class CoreRuntimeModule {
  static register(configuration: RuntimeConfiguration) {
    return {
      module: CoreRuntimeModule,
      imports: [PilotPersistenceModule.register(configuration)],
      providers: [{
        provide: CORE_RUNTIME,
        useFactory: (workspaceModelPolicies: WorkspaceModelPolicyRepository, auditEvents: AuditEventRepository) =>
          createCoreRuntime(configuration, { workspaceModelPolicies, auditEvents }),
        inject: [WORKSPACE_MODEL_POLICIES, AUDIT_EVENTS],
      }],
      exports: [CORE_RUNTIME],
    };
  }
}
