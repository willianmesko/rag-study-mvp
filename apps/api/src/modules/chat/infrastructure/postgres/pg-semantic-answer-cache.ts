import type { Pool } from "pg";
import { z } from "zod";
import { decodeStoredRecord } from "../../../../platform/database/stored-record.js";
import type { Citation } from "../../../knowledge/index.js";
import type { SemanticAnswerCache, SemanticCacheEntry } from "../../application/ports/semantic-answer-cache.js";
import { EmbeddingIndexChangedError } from "../../../ai/index.js";
import { toVectorLiteral } from "../../../../platform/database/pgvector.js";
import { requireActiveEmbeddingRevision, withWorkspaceLock } from "../../../../platform/database/workspace-embedding-lock.js";
import { withPostgresTransaction } from "../../../../platform/database/sql-boundary.js";

const citation = z.object({
  chunkId: z.uuid(), documentId: z.uuid(), source: z.string(), title: z.string().nullable(),
  ordinal: z.number().int().nonnegative(), score: z.number(), content: z.string(),
}) satisfies z.ZodType<Citation>;
const cacheRow = z.object({ answer: z.string(), sources: z.array(citation).max(20), similarity: z.number().min(-1).max(1) });

export class PgSemanticAnswerCache implements SemanticAnswerCache {
  constructor(private readonly pool: Pool, private readonly dimensions: number) {}

  async findSimilar(input: Parameters<SemanticAnswerCache["findSimilar"]>[0]): Promise<SemanticCacheEntry | null> {
    const read = (db: Pick<Pool, "query">) => db.query<Record<string, unknown>>(
      `SELECT answer, sources, (1 - (embedding <=> $2::vector))::float8 AS similarity
       FROM semantic_model_answer_cache
       WHERE tenant_id = $1 AND model_key = $3 AND expires_at > NOW()
       ORDER BY embedding <=> $2::vector
       LIMIT 1`,
      [input.tenantId, toVectorLiteral(input.embedding, this.dimensions), input.modelKey]
    );
    const result = input.embeddingIndexVersion
      ? await withWorkspaceLock(this.pool, input.tenantId, "shared", async (client) => {
        await requireActiveEmbeddingRevision(client, input.tenantId, input.embeddingIndexVersion);
        return read(client);
      }, { signal: input.signal, workload: "retrieval" })
      : await withPostgresTransaction(this.pool, read, { signal: input.signal, workload: "retrieval", readOnly: true });
    if (result.rows.length === 0) return null;
    const row = decodeStoredRecord(cacheRow, result.rows[0]);
    if (row.similarity < input.minimumSimilarity) return null;
    return { answer: row.answer, sources: row.sources, similarity: row.similarity };
  }

  async put(input: Parameters<SemanticAnswerCache["put"]>[0]): Promise<void> {
    const write = (db: Pick<Pool, "query">) => db.query(
      `INSERT INTO semantic_model_answer_cache (tenant_id, model_key, question_hash, embedding, answer, sources, expires_at)
       VALUES ($1, $2, $3, $4::vector, $5, $6::jsonb, $7)
       ON CONFLICT (tenant_id, model_key, question_hash) DO UPDATE
       SET embedding = EXCLUDED.embedding, answer = EXCLUDED.answer, sources = EXCLUDED.sources, expires_at = EXCLUDED.expires_at`,
      [input.tenantId, input.modelKey, input.questionHash, toVectorLiteral(input.embedding, this.dimensions), input.answer, JSON.stringify(input.sources), input.expiresAt]
    );
    if (!input.embeddingIndexVersion) {
      await write(this.pool);
      return;
    }
    try {
      await withWorkspaceLock(this.pool, input.tenantId, "shared", async (client) => {
        await requireActiveEmbeddingRevision(client, input.tenantId, input.embeddingIndexVersion);
        await write(client);
      });
    } catch (error) {
      // An answer read before the cutover can finish generation after it.
      // Such a request must not put its obsolete vectors back into the cache.
      if (!(error instanceof EmbeddingIndexChangedError)) throw error;
    }
  }

  async invalidateTenant(tenantId: string): Promise<void> {
    await this.pool.query(
      `WITH legacy AS (DELETE FROM semantic_answer_cache WHERE tenant_id = $1)
       DELETE FROM semantic_model_answer_cache WHERE tenant_id = $1`,
      [tenantId]
    );
  }
}
