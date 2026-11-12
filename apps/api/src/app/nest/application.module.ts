import { Module, type DynamicModule } from "@nestjs/common";
import type { WorkspaceModelPolicyRepository } from "../../modules/chat/application/ports/workspace-model-policy-repository.js";
import type { HttpDependencies } from "../http-dependencies.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import { createApplication } from "../app.module.js";
import { PilotPersistenceModule } from "./persistence.module.js";
import { HealthController } from "./health.controller.js";
import { APPLICATION_RUNTIME, HTTP_DEPENDENCIES, RUNTIME_CONFIGURATION, WORKSPACE_MODEL_POLICIES } from "./tokens.js";

@Module({})
export class NestApplicationModule {
  static register(configuration: RuntimeConfiguration, dependencies?: HttpDependencies): DynamicModule {
    return {
      module: NestApplicationModule,
      imports: dependencies ? [] : [PilotPersistenceModule.register(configuration)],
      controllers: [HealthController],
      providers: [
        { provide: RUNTIME_CONFIGURATION, useValue: configuration },
        ...(dependencies ? [{ provide: HTTP_DEPENDENCIES, useValue: dependencies }] : [
          // Transitional bridge: migrate existing feature factories module by module.
          { provide: APPLICATION_RUNTIME, useFactory: (workspaceModelPolicies: WorkspaceModelPolicyRepository) => {
            const application = createApplication(configuration, { workspaceModelPolicies });
            return Object.assign(application, { onModuleDestroy: () => application.close() });
          }, inject: [WORKSPACE_MODEL_POLICIES] },
          { provide: HTTP_DEPENDENCIES, useFactory: (application: ReturnType<typeof createApplication>) => application.useCases, inject: [APPLICATION_RUNTIME] },
        ]),
      ],
    };
  }
}
