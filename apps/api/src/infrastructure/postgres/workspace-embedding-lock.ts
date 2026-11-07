import type { Pool, PoolClient } from "pg";
import { EmbeddingIndexChangedError } from "../../application/ports/workspace-embedding-index.js";

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

export async function withWorkspaceLock<T>(pool: Pool, tenantId: string, mode: "shared" | "exclusive", operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN; SET LOCAL lock_timeout = '5s'");
    if (!await lockWorkspace(client, tenantId, mode)) throw new Error("Workspace does not exist.");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
