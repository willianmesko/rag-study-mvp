import type { WorkspaceModelPolicyRepository } from "../../modules/chat/application/ports/workspace-model-policy-repository.js";
import { PgIngestionJobRepository } from "../../modules/ingestion/infrastructure/postgres/pg-ingestion-job-repository.js";
import { createPostgresPool } from "../../platform/database/pool.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import { createChatStorage } from "./chat-storage.js";
import { createIdentityServices } from "./identity.js";
import { createPostgresAccessBindings } from "./postgres-persistence.js";
import { createConfiguredProviderBindings } from "./provider-registry.js";
import { createSupabaseOriginalFileStore } from "./supabase-bindings.js";
import { createWorkflowRuntime } from "./workflow-runtime.js";
export function createCoreRuntime(config: RuntimeConfiguration, overrides: {
    workspaceModelPolicies?: WorkspaceModelPolicyRepository;
} = {}) {
    const identityServices = createIdentityServices({
        url: config.SUPABASE_URL,
        publishableKey: config.SUPABASE_PUBLISHABLE_KEY,
        serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
        timeoutMs: Math.min(config.PROVIDER_TIMEOUT_MS, 10000),
    });
    const pool = createPostgresPool(config.DATABASE_URL);
    const providerBindings = createConfiguredProviderBindings(config);
    const mcpReadPool = config.MCP_ENABLED
        ? createPostgresPool(config.MCP_READ_DATABASE_URL ?? config.DATABASE_URL, 2)
        : null;
    const jobs = new PgIngestionJobRepository(pool);
    const { quotas, auditEvents } = createPostgresAccessBindings(pool);
    const originals = createSupabaseOriginalFileStore({
        url: config.SUPABASE_URL,
        serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
        uploadBucket: config.SUPABASE_UPLOAD_BUCKET,
    });
    const { chatRuns, conversations, semanticCache, workspaceModelPolicies } = createChatStorage(pool, config.EMBEDDING_DIMENSIONS, overrides.workspaceModelPolicies);
    const engine = createWorkflowRuntime(pool, config, (code) => console.error(JSON.stringify({ event: "workflow_failure", reason: code })));
    return { identityServices, pool, providerBindings, mcpReadPool, jobs, quotas, auditEvents, originals, chatRuns, conversations, semanticCache, workspaceModelPolicies, engine };
}
export type CoreRuntime = ReturnType<typeof createCoreRuntime>;
