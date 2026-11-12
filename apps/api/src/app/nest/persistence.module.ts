import { PrismaAuditEventRepository } from "../../modules/usage/infrastructure/prisma/prisma-audit-event-repository.js";
import { Module } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPostgresPool } from "../../platform/database/pool.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import { PrismaWorkspaceModelPolicyRepository } from "../../modules/chat/infrastructure/prisma/prisma-workspace-model-policy-repository.js";
import { AUDIT_EVENTS, RUNTIME_CONFIGURATION, WORKSPACE_MODEL_POLICIES } from "./tokens.js";

/** A bounded pilot pool; SQL deadlines, safe pool errors and TLS remain shared policy. */
export class PrismaPersistence {
  readonly pool;
  readonly client;
  constructor(configuration: RuntimeConfiguration) {
    this.pool = createPostgresPool(configuration.DATABASE_URL, 2);
    this.client = new PrismaClient({ adapter: new PrismaPg(this.pool), log: [] });
  }
  async onModuleDestroy(): Promise<void> {
    try { await this.client.$disconnect(); } finally { await this.pool.end(); }
  }
}

@Module({})
export class PilotPersistenceModule {
  static register(configuration: RuntimeConfiguration) {
    return {
      module: PilotPersistenceModule,
      providers: [
        { provide: RUNTIME_CONFIGURATION, useValue: configuration },
        { provide: PrismaPersistence, useFactory: (config: RuntimeConfiguration) => new PrismaPersistence(config), inject: [RUNTIME_CONFIGURATION] },
        { provide: AUDIT_EVENTS, useFactory: (database: PrismaPersistence) => new PrismaAuditEventRepository(database.client), inject: [PrismaPersistence] },
        { provide: WORKSPACE_MODEL_POLICIES, useFactory: (database: PrismaPersistence) => new PrismaWorkspaceModelPolicyRepository(database.client), inject: [PrismaPersistence] },
      ],
      exports: [WORKSPACE_MODEL_POLICIES, AUDIT_EVENTS],
    };
  }
}
