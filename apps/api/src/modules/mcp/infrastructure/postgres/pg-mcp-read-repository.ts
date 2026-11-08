import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { uploadJobSchema } from "@rag-study/contracts";
import { decodeStoredRecord, storedRatioSchema as ratio } from "../../../../platform/database/stored-record.js";
import {
  maxMcpPassageChars, type McpEvaluationRecord, type McpIngestionRecord, type McpPassageRecord,
  type McpReadRepository, type McpSearchRecord, type McpSourceRecord
} from "../../application/read-tools.js";
import { readStoredChunkSecurity } from "../../../../platform/database/stored-chunk-security.js";
import type { McpHybridReadRepository } from "../../application/hybrid-search.js";
import type { EmbeddingModelIdentity } from "../../../ai/index.js";
import { toVectorLiteral } from "../../../../platform/database/pgvector.js";
import { postgresDeadlineProfiles, withPostgresTransaction } from "../../../../platform/database/sql-boundary.js";

const sourceRowSchema = z.object({
  id: z.uuid(), source: z.string(), title: z.string().nullable(),
  format: z.string().nullable(), language: z.string().nullable(),
  chunk_count: z.number().int().nonnegative(), updated_at: z.date(),
});
const sourcePage = z.array(sourceRowSchema).max(10);
type SourceRow = z.output<typeof sourceRowSchema>;
type PassageRow = { chunk_id: string; ordinal: number; content: string; security_metadata: unknown };
const ingestionStatusRow = z.object({
  id: z.uuid(), document_id: z.uuid().nullable(),
  status: uploadJobSchema.shape.status,
  progress: uploadJobSchema.shape.progress.pipe(z.number().int()),
  chunk_count: uploadJobSchema.shape.chunkCount,
  updated_at: z.date(),
});
const qualityPage = z.array(z.object({
  id: z.uuid(), dataset_name: z.string(), dataset_version: z.string(), total_cases: z.number().int().nonnegative(),
  hit_rate: ratio, mean_reciprocal_rank: ratio, faithfulness: ratio.nullable(), context_precision: ratio.nullable(),
  injection_pass_rate: ratio, passed: z.boolean(), created_at: z.date()
})).max(10);

const sourceColumns = `d.id, left(d.source, 1001) AS source, left(d.title, 1001) AS title,
  left(d.metadata ->> 'format', 16) AS format, left(d.metadata ->> 'language', 16) AS language,
  (SELECT COUNT(*)::int FROM public.chunks c WHERE c.document_id = d.id) AS chunk_count, d.updated_at`;
const passageColumns = `c.id AS chunk_id, c.ordinal, c.content,
  CASE WHEN octet_length((c.metadata -> 'security')::text) <= 1024
    THEN jsonb_build_object('security', c.metadata -> 'security') END AS security_metadata`;
const passagePredicate = `c.metadata #>> '{security,promptInjectionRisk}' = 'low'
  AND char_length(c.content) <= ${maxMcpPassageChars}`;

export class PgMcpReadRepository implements McpReadRepository, McpHybridReadRepository {
  constructor(private readonly pool: Pool, private readonly statementTimeoutMs = 2_000) {
    if (!Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs < 1 || statementTimeoutMs > 5_000) {
      throw new Error("Workspace read statements require a timeout between 1 and 5,000 ms.");
    }
  }

  listSources(tenantId: string, limit: number, signal: AbortSignal): Promise<McpSourceRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error("Invalid MCP source limit.");
    return this.read(signal, async (client) => {
      const { rows } = await client.query<Record<string, unknown>>(
        `SELECT ${sourceColumns}
         FROM (
           SELECT id, source, title, metadata, updated_at FROM public.documents
           WHERE tenant_id = $1 ORDER BY updated_at DESC, id LIMIT $2
         ) d
         ORDER BY d.updated_at DESC, d.id`,
        [tenantId, limit]
      );
      return decodeStoredRecord(sourcePage, rows).map(mapSource);
    });
  }

  getIngestionStatus(tenantId: string, jobId: string, signal: AbortSignal): Promise<McpIngestionRecord | null> {
    return this.read(signal, async (client) => {
      const { rows: [stored] } = await client.query<Record<string, unknown>>(
        `SELECT id, document_id, status, progress, chunk_count, updated_at
         FROM public.ingestion_jobs WHERE tenant_id = $1 AND id = $2`,
        [tenantId, jobId]
      );
      if (!stored) return null;
      const row = decodeStoredRecord(ingestionStatusRow, stored);
      return {
        id: row.id, documentId: row.document_id, status: row.status, progress: row.progress,
        chunkCount: row.chunk_count, updatedAt: row.updated_at
      };
    });
  }

  getQualityReport(tenantId: string, limit: number, signal: AbortSignal): Promise<McpEvaluationRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error("Invalid MCP quality-report limit.");
    return this.read(signal, async (client) => {
      const { rows } = await client.query<Record<string, unknown>>(
        `SELECT id, left(dataset_name, 1001) AS dataset_name, left(dataset_version, 1001) AS dataset_version,
                total_cases, hit_rate, mean_reciprocal_rank, faithfulness, context_precision,
                injection_pass_rate, passed, created_at
         FROM public.evaluation_runs WHERE tenant_id = $1 ORDER BY created_at DESC, id LIMIT $2`,
        [tenantId, limit]
      );
      return decodeStoredRecord(qualityPage, rows).map((row) => ({
        id: row.id, datasetName: row.dataset_name, datasetVersion: row.dataset_version,
        totalCases: row.total_cases, hitRate: row.hit_rate, meanReciprocalRank: row.mean_reciprocal_rank,
        faithfulness: row.faithfulness, contextPrecision: row.context_precision,
        injectionPassRate: row.injection_pass_rate, passed: row.passed, createdAt: row.created_at
      }));
    });
  }

  getDocument(tenantId: string, documentId: string, limit: number, signal: AbortSignal) {
    return this.read(signal, async (client) => {
      const { rows: [storedDocument] } = await client.query<Record<string, unknown>>(
        `SELECT ${sourceColumns} FROM public.documents d WHERE d.tenant_id = $1 AND d.id = $2`,
        [tenantId, documentId]
      );
      if (!storedDocument) return null;
      const document = decodeStoredRecord(sourceRowSchema, storedDocument);
      signal.throwIfAborted();
      const { rows } = await client.query<PassageRow>(
        `SELECT ${passageColumns}
         FROM public.chunks c JOIN public.documents d ON d.id = c.document_id
         WHERE d.tenant_id = $1 AND d.id = $2 AND ${passagePredicate}
         ORDER BY c.ordinal LIMIT $3`,
        [tenantId, documentId, limit]
      );
      return { document: mapSource(document), passages: rows.map(mapPassage) };
    });
  }

  search(tenantId: string, lexicalQuery: string, limit: number, signal: AbortSignal): Promise<McpSearchRecord[]> {
    return this.read(signal, async (client) => {
      const { rows } = await client.query<PassageRow & { document_id: string; source: string; title: string | null; score: number }>(
        `WITH search AS (SELECT plainto_tsquery('portuguese'::regconfig, $2) AS query)
         SELECT ${passageColumns}, c.document_id, left(d.source, 1001) AS source, left(d.title, 1001) AS title,
                ts_rank_cd(c.search_vector, search.query)::float8 AS score
         FROM public.chunks c JOIN public.documents d ON d.id = c.document_id CROSS JOIN search
         WHERE d.tenant_id = $1 AND c.search_vector @@ search.query AND ${passagePredicate}
         ORDER BY score DESC, c.id LIMIT $3`,
        [tenantId, lexicalQuery, limit]
      );
      return rows.map((row) => ({
        ...mapPassage(row), documentId: row.document_id, source: row.source, title: row.title, score: row.score
      }));
    });
  }

  activeIndex(tenantId: string, signal: AbortSignal) {
    return this.read(signal, async (client) => {
      const { rows } = await client.query<EmbeddingModelIdentity & { revision: string }>(
        "SELECT provider, model, dimensions, revision FROM public.workspace_embedding_versions WHERE tenant_id=$1 AND state='active'", [tenantId]);
      return rows[0] ?? null;
    });
  }

  hybrid(input: Parameters<McpHybridReadRepository["hybrid"]>[0]): Promise<McpSearchRecord[]> {
    const vector = toVectorLiteral(input.embedding, 1024);
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 5) throw new Error("Invalid MCP result limit.");
    return this.read(input.signal, async (client) => {
      const version = await client.query("SELECT 1 FROM public.workspace_embedding_versions WHERE tenant_id=$1 AND revision=$2 AND state='active'", [input.tenantId, input.revision]);
      if (!version.rowCount) throw new Error("The MCP embedding index changed; retry with the active index.");
      const { rows } = await client.query<PassageRow & { document_id: string; source: string; title: string | null; score: number }>(
        `WITH active AS (
           SELECT 1 FROM public.workspace_embedding_versions WHERE tenant_id=$1 AND revision=$5 AND state='active'
         ), lexical AS (SELECT plainto_tsquery('portuguese'::regconfig,$3) AS query),
         nearest AS (
           SELECT c.id, row_number() OVER (ORDER BY c.embedding <=> $2::vector, c.id) AS position
           FROM public.chunks c JOIN public.documents d ON d.id=c.document_id CROSS JOIN active
           WHERE d.tenant_id=$1 AND ${passagePredicate}
           ORDER BY c.embedding <=> $2::vector, c.id LIMIT $6
         ), textual AS (
           SELECT c.id, row_number() OVER (ORDER BY ts_rank_cd(c.search_vector,lexical.query) DESC,c.id) AS position
           FROM public.chunks c JOIN public.documents d ON d.id=c.document_id CROSS JOIN active CROSS JOIN lexical
           WHERE d.tenant_id=$1 AND c.search_vector @@ lexical.query AND ${passagePredicate}
           ORDER BY ts_rank_cd(c.search_vector,lexical.query) DESC,c.id LIMIT $6
         ), fusion AS (
           SELECT id, sum(1.0/(60+position)) AS rrf FROM (
             SELECT * FROM nearest UNION ALL SELECT * FROM textual
           ) candidates GROUP BY id
         )
         SELECT ${passageColumns},c.document_id,left(d.source,1001) AS source,left(d.title,1001) AS title,
           (1-(c.embedding <=> $2::vector))::float8 AS score
         FROM fusion f JOIN public.chunks c ON c.id=f.id
         JOIN public.documents d ON d.id=c.document_id AND d.tenant_id=$1
         ORDER BY f.rrf DESC,c.id LIMIT $4`,
        [input.tenantId, vector, input.lexicalQuery, input.limit, input.revision, input.limit * 4]);
      return rows.map((row) => ({ ...mapPassage(row), documentId: row.document_id, source: row.source, title: row.title, score: row.score }));
    });
  }

  private async read<Result>(signal: AbortSignal, query: (client: PoolClient) => Promise<Result>): Promise<Result> {
    return withPostgresTransaction(this.pool, query, {
      signal,
      readOnly: true,
      limits: {
        ...postgresDeadlineProfiles.retrieval,
        statementMs: this.statementTimeoutMs,
        idleTransactionMs: this.statementTimeoutMs,
      },
    });
  }
}

function mapSource(row: SourceRow): McpSourceRecord {
  return {
    id: row.id, source: row.source, title: row.title, format: row.format,
    language: row.language, chunkCount: row.chunk_count, updatedAt: row.updated_at
  };
}

function mapPassage(row: PassageRow): McpPassageRecord {
  return {
    chunkId: row.chunk_id, ordinal: row.ordinal, content: row.content,
    security: readStoredChunkSecurity(row.security_metadata)
  };
}
