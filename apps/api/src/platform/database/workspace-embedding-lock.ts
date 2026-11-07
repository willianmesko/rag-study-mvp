import type { Pool, PoolClient } from "pg";
import { EmbeddingIndexChangedError } from "./embedding-index-error.js";
import { withPostgresTransaction, type PostgresWorkload } from "./sql-boundary.js";

export async function lockWorkspace(client: PoolClient, tenantId: string, mode: "shared" | "exclusive"): Promise<boolean> {
  const lock = mode === "shared" ? "SHARE" : "UPDATE";
  const result = await client.query(`SELECT id FROM tenants WHERE id = $1 FOR ${lock}`, [tenantId]);
  return result.rowCount === 1;
}

export async function requireActiveEmbeddingRevision(client: PoolClient, tenantId: string, revision?: string): Promise<void> {
  const result = await client.query<{ revision: string }>(
    "SELECT revision FROM workspace_embedding_versions WHERE tenant_id = $1 AND state = 'active'",
    [tenantId]
  );
  if (result.rows[0]?.revision !== revision) throw new EmbeddingIndexChangedError();
}

export async function withWorkspaceLock<T>(pool: Pool, tenantId: string, mode: "shared" | "exclusive", operation: (client: PoolClient) => Promise<T>, options: { signal?: AbortSignal; workload?: PostgresWorkload } = {}): Promise<T> {
  return withPostgresTransaction(pool, async (client) => {
    if (!await lockWorkspace(client, tenantId, mode)) throw new Error("Workspace does not exist.");
    return operation(client);
  }, options);
}
