import type { Pool } from "pg";
import type { Citation } from "../../domain/document.js";
import type { SemanticAnswerCache, SemanticCacheEntry } from "../../application/ports/semantic-answer-cache.js";
import { toVectorLiteral } from "./pgvector.js";

type CacheRow = { answer: string; sources: Citation[]; similarity: number };

export class PgSemanticAnswerCache implements SemanticAnswerCache {
  constructor(private readonly pool: Pool, private readonly dimensions: number) {}

  async findSimilar(input: Parameters<SemanticAnswerCache["findSimilar"]>[0]): Promise<SemanticCacheEntry | null> {
    const result = await this.pool.query<CacheRow>(
      `SELECT answer, sources, (1 - (embedding <=> $2::vector))::float8 AS similarity
       FROM semantic_model_answer_cache
       WHERE tenant_id = $1 AND model_key = $3 AND expires_at > NOW()
       ORDER BY embedding <=> $2::vector
       LIMIT 1`,
      [input.tenantId, toVectorLiteral(input.embedding, this.dimensions), input.modelKey]
    );
    const row = result.rows[0];
    if (!row || Number(row.similarity) < input.minimumSimilarity) return null;
    return { answer: row.answer, sources: row.sources, similarity: Number(row.similarity) };
  }

  async put(input: Parameters<SemanticAnswerCache["put"]>[0]): Promise<void> {
    await this.pool.query(
      `INSERT INTO semantic_model_answer_cache (tenant_id, model_key, question_hash, embedding, answer, sources, expires_at)
       VALUES ($1, $2, $3, $4::vector, $5, $6::jsonb, $7)
       ON CONFLICT (tenant_id, model_key, question_hash) DO UPDATE
       SET embedding = EXCLUDED.embedding, answer = EXCLUDED.answer, sources = EXCLUDED.sources, expires_at = EXCLUDED.expires_at`,
      [input.tenantId, input.modelKey, input.questionHash, toVectorLiteral(input.embedding, this.dimensions), input.answer, JSON.stringify(input.sources), input.expiresAt]
    );
  }

  async invalidateTenant(tenantId: string): Promise<void> {
    await this.pool.query(
      `WITH legacy AS (DELETE FROM semantic_answer_cache WHERE tenant_id = $1)
       DELETE FROM semantic_model_answer_cache WHERE tenant_id = $1`,
      [tenantId]
    );
  }
}
