import type { Pool, PoolClient } from "pg";
import { validateWorkspaceEmbedding, workspaceEmbeddingDimensions, type EmbeddingModelIdentity, type WorkspaceEmbeddingIndexRepository, type WorkspaceEmbeddingVersion } from "../../application/ports/workspace-embedding-index.js";
import { toVectorLiteral } from "../../../../platform/database/pgvector.js";
import { withWorkspaceLock } from "../../../../platform/database/workspace-embedding-lock.js";
import { withPostgresTransaction } from "../../../../platform/database/sql-boundary.js";

const versionColumns = "id, revision, provider, model, dimensions, state";

async function insertVersion(client: PoolClient, tenantId: string, model: EmbeddingModelIdentity, state: "active" | "building"): Promise<WorkspaceEmbeddingVersion> {
  const result = await client.query<WorkspaceEmbeddingVersion>(
    `INSERT INTO workspace_embedding_versions (tenant_id, provider, model, dimensions, state)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${versionColumns}`,
    [tenantId, model.provider, model.model, model.dimensions, state]
  );
  return result.rows[0]!;
}

async function findVersion(db: Pick<Pool, "query">, tenantId: string, state: WorkspaceEmbeddingVersion["state"]): Promise<WorkspaceEmbeddingVersion | undefined> {
  const result = await db.query<WorkspaceEmbeddingVersion>(
    `SELECT ${versionColumns} FROM workspace_embedding_versions WHERE tenant_id = $1 AND state = $2`, [tenantId, state]
  );
  return result.rows[0];
}

function matchesModel(version: WorkspaceEmbeddingVersion, model: EmbeddingModelIdentity): boolean {
  return version.provider === model.provider && version.model === model.model && version.dimensions === model.dimensions;
}

export class PgWorkspaceEmbeddingIndex implements WorkspaceEmbeddingIndexRepository {
  constructor(private readonly pool: Pool) {}

  async getOrPinActive(tenantId: string, initial: EmbeddingModelIdentity, signal?: AbortSignal): Promise<WorkspaceEmbeddingVersion> {
    const options = signal ? { signal, workload: "retrieval" as const } : {};
    const active = await withPostgresTransaction(this.pool, (client) => findVersion(client, tenantId, "active"), { ...options, readOnly: true });
    if (active) return active;
    return withWorkspaceLock(this.pool, tenantId, "exclusive", async (client) =>
      await findVersion(client, tenantId, "active") ?? await insertVersion(client, tenantId, initial, "active"), options);
  }

  startBuild(tenantId: string, model: EmbeddingModelIdentity): Promise<WorkspaceEmbeddingVersion> {
    return withWorkspaceLock(this.pool, tenantId, "exclusive", async (client) => {
      const active = await findVersion(client, tenantId, "active");
      if (!active) throw new Error("Pin the current workspace embedding model before staging a rebuild.");
      if (matchesModel(active, model)) throw new Error("This is already the active workspace embedding model.");
      const existing = await findVersion(client, tenantId, "building");
      if (existing) {
        if (!matchesModel(existing, model)) throw new Error("Another version is building. Discard it before staging a different model.");
        return existing;
      }
      return insertVersion(client, tenantId, model, "building");
    });
  }

  async nextUnindexedChunks(tenantId: string, versionId: string, limit: number): Promise<Array<{ id: string; content: string }>> {
    const result = await this.pool.query<{ id: string; content: string }>(
      `SELECT c.id, c.content
       FROM documents d JOIN chunks c ON c.document_id = d.id
       JOIN workspace_embedding_versions v ON v.tenant_id = d.tenant_id AND v.id = $2 AND v.state = 'building'
       LEFT JOIN workspace_embedding_staged_vectors s ON s.tenant_id = v.tenant_id AND s.version_id = v.id AND s.chunk_id = c.id
       WHERE d.tenant_id = $1 AND s.chunk_id IS NULL
       ORDER BY c.id LIMIT $3`, [tenantId, versionId, limit]
    );
    return result.rows;
  }

  async stageVectors(tenantId: string, versionId: string, vectors: Array<{ id: string; embedding: number[] }>): Promise<number> {
    if (vectors.length === 0) return 0;
    const entries = vectors.map(({ id, embedding }) => {
      validateWorkspaceEmbedding(embedding);
      return { id, embedding: toVectorLiteral(embedding, workspaceEmbeddingDimensions) };
    });
    // Each small batch is persisted under the corpus lock, so it cannot race
    // a document replacement that deletes and recreates its chunk IDs.
    return withWorkspaceLock(this.pool, tenantId, "exclusive", async (client) => {
      const build = await findVersion(client, tenantId, "building");
      if (build?.id !== versionId) throw new Error("The requested version is no longer building in this workspace.");
      const result = await client.query(
        `INSERT INTO workspace_embedding_staged_vectors (tenant_id, version_id, chunk_id, embedding)
         SELECT $1, $2, c.id, incoming.embedding::vector
         FROM jsonb_to_recordset($3::jsonb) AS incoming(id UUID, embedding TEXT)
         JOIN chunks c ON c.id = incoming.id
         JOIN documents d ON d.id = c.document_id AND d.tenant_id = $1
         ON CONFLICT (tenant_id, version_id, chunk_id) DO NOTHING`,
        [tenantId, versionId, JSON.stringify(entries)]
      );
      return result.rowCount ?? 0;
    });
  }

  async status(tenantId: string): Promise<Array<WorkspaceEmbeddingVersion & { totalChunks: number; indexedChunks: number }>> {
    const result = await this.pool.query<WorkspaceEmbeddingVersion & { totalChunks: number; indexedChunks: number }>(
      `WITH corpus AS (
         SELECT COUNT(*)::int AS total FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.tenant_id = $1
       )
       SELECT ${versionColumns}, corpus.total AS "totalChunks",
         CASE WHEN v.state = 'active' THEN corpus.total ELSE (
           SELECT COUNT(*)::int FROM workspace_embedding_staged_vectors s WHERE s.tenant_id = v.tenant_id AND s.version_id = v.id
         ) END AS "indexedChunks"
       FROM workspace_embedding_versions v CROSS JOIN corpus WHERE v.tenant_id = $1 ORDER BY v.created_at DESC`,
      [tenantId]
    );
    return result.rows;
  }

  switchActive(tenantId: string, versionId: string, operation: "activate" | "rollback"): Promise<WorkspaceEmbeddingVersion> {
    return withWorkspaceLock(this.pool, tenantId, "exclusive", async (client) => {
      const active = await findVersion(client, tenantId, "active");
      const target = await findVersion(client, tenantId, operation === "activate" ? "building" : "previous");
      if (!active || target?.id !== versionId) throw new Error("The requested version is not available for this operation in the workspace.");

      // Corpus writes take the same workspace lock in shared mode. Hold the
      // exclusive lock only for SQL, after the candidate provider work is done.
      const missing = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM chunks c
         JOIN documents d ON d.id = c.document_id
         LEFT JOIN workspace_embedding_staged_vectors s ON s.tenant_id = d.tenant_id AND s.version_id = $2 AND s.chunk_id = c.id
         WHERE d.tenant_id = $1 AND s.chunk_id IS NULL`, [tenantId, versionId]
      );
      const missingCount = missing.rows[0]!.count;
      if (missingCount > 0) {
        const action = operation === "activate" ? "Resume the staged rebuild before activating." : "Stage a complete rebuild with the previous model before switching back.";
        throw new Error(`The requested version is missing ${missingCount} current chunk vectors. ${action}`);
      }

      await client.query("SET CONSTRAINTS workspace_embedding_state_unique DEFERRED");
      await client.query("DELETE FROM workspace_embedding_versions WHERE tenant_id = $1 AND state = 'previous' AND id <> $2", [tenantId, versionId]);
      await client.query(
        `INSERT INTO workspace_embedding_staged_vectors (tenant_id, version_id, chunk_id, embedding)
         SELECT $1, $2, c.id, c.embedding FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.tenant_id = $1`,
        [tenantId, active.id]
      );
      await client.query(
        `UPDATE chunks c SET embedding = s.embedding
         FROM workspace_embedding_staged_vectors s, documents d
         WHERE s.tenant_id = $1 AND s.version_id = $2 AND s.chunk_id = c.id AND d.id = c.document_id AND d.tenant_id = $1`,
        [tenantId, versionId]
      );
      await client.query("DELETE FROM workspace_embedding_staged_vectors WHERE tenant_id = $1 AND version_id = $2", [tenantId, versionId]);
      await client.query("UPDATE workspace_embedding_versions SET state = 'previous' WHERE tenant_id = $1 AND id = $2", [tenantId, active.id]);
      const updated = await client.query<WorkspaceEmbeddingVersion>(
        `UPDATE workspace_embedding_versions SET state = 'active', revision = gen_random_uuid()
         WHERE tenant_id = $1 AND id = $2 RETURNING ${versionColumns}`, [tenantId, versionId]
      );
      await client.query("DELETE FROM semantic_answer_cache WHERE tenant_id = $1", [tenantId]);
      await client.query("DELETE FROM semantic_model_answer_cache WHERE tenant_id = $1", [tenantId]);
      return updated.rows[0]!;
    });
  }

  async discardBuild(tenantId: string, versionId: string): Promise<void> {
    await withWorkspaceLock(this.pool, tenantId, "exclusive", async (client) => {
      const deleted = await client.query("DELETE FROM workspace_embedding_versions WHERE tenant_id = $1 AND id = $2 AND state = 'building'", [tenantId, versionId]);
      if (deleted.rowCount !== 1) throw new Error("The requested version is not building in this workspace.");
    });
  }
}
