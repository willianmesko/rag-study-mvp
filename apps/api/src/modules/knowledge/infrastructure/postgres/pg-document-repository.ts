import type { Pool, PoolClient } from "pg";
import type { DocumentFilters } from "@rag-study/contracts";
import type { DocumentRepository, HybridSearchInput, ManagedDocument, StoredChunk } from "../../application/ports/document-repository.js";
import type { EmbeddedChunk, RetrievedChunk } from "../../domain/document.js";
import { indexedOriginalPredicate } from "../../../../platform/database/indexed-original.js";
import { toVectorLiteral } from "../../../../platform/database/pgvector.js";
import { readStoredChunkSecurity } from "../../../../platform/database/stored-chunk-security.js";
import { requireActiveEmbeddingRevision, withWorkspaceLock } from "../../../../platform/database/workspace-embedding-lock.js";
import { lockWorkflowFence } from "../../../../platform/database/workflow-fence.js";
import { currentExecution } from "../../../../platform/workflows/execution-context.js";
import { WorkflowGuardError } from "../../../../platform/workflows/types.js";

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

type ManagedDocumentRow = {
  id: string;
  source: string;
  title: string | null;
  chunk_count: number;
  has_original: boolean;
  format: string | null;
  language: string | null;
  section_count: unknown;
  created_at: Date;
  updated_at: Date;
};

type StoredChunkRow = {
  id: string;
  ordinal: number;
  content: string;
  metadata: unknown;
  created_at: Date;
};

export class PgDocumentRepository implements DocumentRepository {
  constructor(private readonly pool: Pool, private readonly embeddingDimensions: number) {}

  replace(
    input: Parameters<DocumentRepository["replace"]>[0],
    chunks: EmbeddedChunk[]
  ): Promise<{ id: string; chunkCount: number }> {
    return withWorkspaceLock(this.pool, input.tenantId, "shared", async (client) => {
      await lockWorkflowFence(client,input.tenantId);
      const execution=currentExecution();
      if(execution?.lease.kind==='ingestion') {
        const active=await client.query("SELECT 1 FROM ingestion_jobs WHERE tenant_id=$1 AND id=$2 AND status='processing' FOR SHARE",[input.tenantId,execution.lease.runId]);
        if(!active.rowCount)throw new WorkflowGuardError('authorization_revoked');
      }
      await requireActiveEmbeddingRevision(client, input.tenantId, input.embeddingIndexVersion);
      const document = await client.query<{ id: string }>(
        `INSERT INTO documents (tenant_id, source, title, metadata)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (tenant_id, source) DO UPDATE SET title = EXCLUDED.title, metadata = EXCLUDED.metadata, updated_at = NOW()
         RETURNING id`,
        [input.tenantId, input.source, input.title ?? null, JSON.stringify(input.metadata)]
      );
      const documentId = document.rows[0]?.id;
      if (!documentId) throw new Error("Unable to create or update document.");

      await client.query("DELETE FROM chunks WHERE document_id = $1", [documentId]);
      for (const chunk of chunks) await this.insertChunk(client, documentId, chunk);
      return { id: documentId, chunkCount: chunks.length };
    }, { signal: input.signal });
  }

  async findHybrid(input: HybridSearchInput): Promise<RetrievedChunk[]> {
    const result = await withWorkspaceLock(this.pool, input.tenantId, "shared", async (client) => {
      await requireActiveEmbeddingRevision(client, input.tenantId, input.embeddingIndexVersion);
      return client.query<SearchRow>(
      `WITH text_query AS (
         SELECT websearch_to_tsquery('portuguese'::regconfig, $3) AS query
       ),
       vector_candidates AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY cosine_distance) AS vector_rank
         FROM (
           SELECT c.id, c.embedding <=> $1::vector AS cosine_distance
           FROM chunks c
           JOIN documents d ON d.id = c.document_id
           WHERE d.tenant_id = $7
           ORDER BY c.embedding <=> $1::vector
           LIMIT $2
         ) nearest
       ),
       keyword_candidates AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY text_score DESC, id) AS keyword_rank
         FROM (
           SELECT c.id, ts_rank_cd(c.search_vector, q.query) AS text_score
           FROM chunks c
           JOIN documents d ON d.id = c.document_id
           CROSS JOIN text_query q
           WHERE d.tenant_id = $7 AND c.search_vector @@ q.query
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
       JOIN documents d ON d.id = c.document_id AND d.tenant_id = $7
       ORDER BY f.fusion_score DESC, c.id
       LIMIT $6`,
      [
        toVectorLiteral(input.embedding, this.embeddingDimensions),
        input.vectorCandidateLimit,
        input.lexicalQuery,
        input.keywordCandidateLimit,
        input.reciprocalRankConstant,
        input.limit,
        input.tenantId
      ]
      );
    }, { signal: input.signal, workload: "retrieval" });
    return result.rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      ordinal: row.ordinal,
      content: row.content,
      source: row.source,
      title: row.title,
      score: Number(row.score),
      security: readStoredChunkSecurity(row.metadata),
      retrieval: {
        vectorRank: row.vector_rank === null ? null : Number(row.vector_rank),
        keywordRank: row.keyword_rank === null ? null : Number(row.keyword_rank),
        fusionScore: Number(row.fusion_score)
      }
    }));
  }

  async list(tenantId: string, limit: number, filters: DocumentFilters = {}): Promise<ManagedDocument[]> {
    const values: unknown[] = [tenantId, limit];
    const predicates = ["d.tenant_id = $1"];
    const add = (value: string, expression: (parameter: string) => string) => {
      values.push(value);
      predicates.push(expression(`$${values.length}`));
    };
    if (filters.q) add(filters.q, (p) => `strpos(lower(COALESCE(d.title, '') || ' ' || d.source), lower(${p})) > 0`);
    if (filters.source) add(filters.source, (p) => `strpos(lower(d.source), lower(${p})) > 0`);
    if (filters.documentId) add(filters.documentId, (p) => `d.id = ${p}::uuid`);
    if (filters.language) add(filters.language, (p) => `COALESCE(NULLIF(d.metadata ->> 'language', 'unknown'), 'und') = ${p}`);
    if (filters.format) add(filters.format, (p) => `d.metadata ->> 'format' = ${p}`);
    if (filters.from) add(filters.from, (p) => `d.updated_at >= (${p}::date::timestamp AT TIME ZONE 'UTC')`);
    if (filters.to) add(filters.to, (p) => `d.updated_at < ((${p}::date + 1)::timestamp AT TIME ZONE 'UTC')`);
    const result = await this.pool.query<ManagedDocumentRow>(
      `SELECT d.id, d.source, d.title, COUNT(c.id)::int AS chunk_count, d.created_at, d.updated_at,
              d.metadata ->> 'format' AS format, d.metadata ->> 'language' AS language,
              d.metadata -> 'sectionCount' AS section_count,
              EXISTS (SELECT 1 FROM ingestion_jobs j WHERE ${indexedOriginalPredicate}) AS has_original
       FROM documents d
       LEFT JOIN chunks c ON c.document_id = d.id
       WHERE ${predicates.join(" AND ")}
       GROUP BY d.id
       ORDER BY d.updated_at DESC, d.id
       LIMIT $2`,
      values
    );
    return result.rows.map((row) => ({
      id: row.id,
      source: row.source,
      title: row.title,
      chunkCount: Number(row.chunk_count),
      hasOriginal: row.has_original,
      format: row.format && ["pdf", "docx", "html", "markdown", "text"].includes(row.format) ? row.format : undefined,
      language: row.language && ["pt", "en", "mixed", "und"].includes(row.language) ? row.language : undefined,
      sectionCount: typeof row.section_count === "number" && Number.isSafeInteger(row.section_count) && row.section_count >= 0 ? row.section_count : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async listChunks(input: { tenantId: string; documentId: string; limit: number }): Promise<StoredChunk[]> {
    const result = await this.pool.query<StoredChunkRow>(
      `SELECT c.id, c.ordinal, c.content, c.metadata, c.created_at
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE d.tenant_id = $1 AND c.document_id = $2
       ORDER BY c.ordinal
       LIMIT $3`,
      [input.tenantId, input.documentId, input.limit]
    );
    return result.rows.map((row) => ({
      id: row.id,
      ordinal: row.ordinal,
      content: row.content,
      security: readStoredChunkSecurity(row.metadata),
      createdAt: row.created_at
    }));
  }

  async delete(input: { tenantId: string; documentId: string }): Promise<boolean> {
    const result = await this.pool.query(
      `WITH workspace_lock AS MATERIALIZED (SELECT id FROM tenants WHERE id = $1 FOR SHARE)
       DELETE FROM documents d USING workspace_lock w WHERE d.tenant_id = w.id AND d.id = $2`,
      [input.tenantId, input.documentId]
    );
    return result.rowCount === 1;
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

