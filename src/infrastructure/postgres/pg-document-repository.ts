import type { Pool, PoolClient } from "pg";
import type { DocumentRepository, HybridSearchInput } from "../../application/ports/document-repository.js";
import type { EmbeddedChunk, RetrievedChunk } from "../../domain/document.js";
import type { PromptInjectionAssessment } from "../../domain/security/prompt-injection.js";
import { toVectorLiteral } from "./pgvector.js";

type SearchRow = {
  chunk_id: string;
  document_id: string;
  ordinal: number;
  content: string;
  source: string;
  title: string | null;
  score: number;
  metadata: unknown;
  vector_rank: number | null;
  keyword_rank: number | null;
  fusion_score: number;
};

const unknownLegacySecurity: PromptInjectionAssessment = {
  promptInjectionRisk: "high",
  signals: ["missing-ingestion-security-label"]
};

function readSecurity(metadata: unknown): PromptInjectionAssessment {
  if (!metadata || typeof metadata !== "object") return unknownLegacySecurity;
  const security = (metadata as { security?: unknown }).security;
  if (!security || typeof security !== "object") return unknownLegacySecurity;
  const risk = (security as { promptInjectionRisk?: unknown }).promptInjectionRisk;
  const signals = (security as { signals?: unknown }).signals;
  if (
    (risk === "low" || risk === "medium" || risk === "high") &&
    Array.isArray(signals) &&
    signals.every((signal) => typeof signal === "string")
  ) {
    return { promptInjectionRisk: risk, signals };
  }
  return unknownLegacySecurity;
}

export class PgDocumentRepository implements DocumentRepository {
  constructor(private readonly pool: Pool, private readonly embeddingDimensions: number) {}

  async replace(
    input: { source: string; title?: string; metadata: Record<string, unknown> },
    chunks: EmbeddedChunk[]
  ): Promise<{ id: string; chunkCount: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const document = await client.query<{ id: string }>(
        `INSERT INTO documents (source, title, metadata)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (source) DO UPDATE SET title = EXCLUDED.title, metadata = EXCLUDED.metadata, updated_at = NOW()
         RETURNING id`,
        [input.source, input.title ?? null, JSON.stringify(input.metadata)]
      );
      const documentId = document.rows[0]?.id;
      if (!documentId) throw new Error("Unable to create or update document.");

      await client.query("DELETE FROM chunks WHERE document_id = $1", [documentId]);
      for (const chunk of chunks) await this.insertChunk(client, documentId, chunk);
      await client.query("COMMIT");
      return { id: documentId, chunkCount: chunks.length };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findHybrid(input: HybridSearchInput): Promise<RetrievedChunk[]> {
    const result = await this.pool.query<SearchRow>(
      `WITH text_query AS (
         SELECT websearch_to_tsquery('portuguese'::regconfig, $3) AS query
       ),
       vector_candidates AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY cosine_distance) AS vector_rank
         FROM (
           SELECT c.id, c.embedding <=> $1::vector AS cosine_distance
           FROM chunks c
           ORDER BY c.embedding <=> $1::vector
           LIMIT $2
         ) nearest
       ),
       keyword_candidates AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY text_score DESC, id) AS keyword_rank
         FROM (
           SELECT c.id, ts_rank_cd(c.search_vector, q.query) AS text_score
           FROM chunks c
           CROSS JOIN text_query q
           WHERE c.search_vector @@ q.query
           ORDER BY text_score DESC, c.id
           LIMIT $4
         ) lexical
       ),
       fused_candidates AS (
         SELECT id,
                MAX(vector_rank) AS vector_rank,
                MAX(keyword_rank) AS keyword_rank,
                SUM(1.0 / ($5 + rank_position))::float8 AS fusion_score
         FROM (
           SELECT id, vector_rank, NULL::bigint AS keyword_rank, vector_rank AS rank_position
           FROM vector_candidates
           UNION ALL
           SELECT id, NULL::bigint AS vector_rank, keyword_rank, keyword_rank AS rank_position
           FROM keyword_candidates
         ) ranked
         GROUP BY id
       )
       SELECT c.id AS chunk_id, c.document_id, c.ordinal, c.content, d.source, d.title,
              (1 - (c.embedding <=> $1::vector))::float8 AS score,
              c.metadata, f.vector_rank, f.keyword_rank, f.fusion_score
       FROM fused_candidates f
       JOIN chunks c ON c.id = f.id
       JOIN documents d ON d.id = c.document_id
       ORDER BY f.fusion_score DESC, c.id
       LIMIT $6`,
      [
        toVectorLiteral(input.embedding, this.embeddingDimensions),
        input.vectorCandidateLimit,
        input.lexicalQuery,
        input.keywordCandidateLimit,
        input.reciprocalRankConstant,
        input.limit
      ]
    );
    return result.rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      ordinal: row.ordinal,
      content: row.content,
      source: row.source,
      title: row.title,
      score: Number(row.score),
      security: readSecurity(row.metadata),
      retrieval: {
        vectorRank: row.vector_rank === null ? null : Number(row.vector_rank),
        keywordRank: row.keyword_rank === null ? null : Number(row.keyword_rank),
        fusionScore: Number(row.fusion_score)
      }
    }));
  }

  private async insertChunk(client: PoolClient, documentId: string, chunk: EmbeddedChunk): Promise<void> {
    await client.query(
      "INSERT INTO chunks (document_id, ordinal, content, embedding, metadata) VALUES ($1, $2, $3, $4::vector, $5::jsonb)",
      [
        documentId,
        chunk.ordinal,
        chunk.content,
        toVectorLiteral(chunk.embedding, this.embeddingDimensions),
        JSON.stringify({ security: chunk.security })
      ]
    );
  }
}

