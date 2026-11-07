import type { Pool, PoolClient } from "pg";
import {
  maxMcpPassageChars, type McpEvaluationRecord, type McpIngestionRecord, type McpPassageRecord,
  type McpReadRepository, type McpSearchRecord, type McpSourceRecord
} from "../../application/mcp/read-tools.js";
import { readStoredChunkSecurity } from "./stored-chunk-security.js";

type SourceRow = {
  id: string;
  source: string;
  title: string | null;
  format: string | null;
  language: string | null;
  chunk_count: number;
  updated_at: Date;
};
type PassageRow = { chunk_id: string; ordinal: number; content: string; security_metadata: unknown };
type IngestionRow = {
  id: string;
  document_id: string | null;
  status: McpIngestionRecord["status"];
  progress: number;
  chunk_count: number | null;
  updated_at: Date;
};
type EvaluationRow = {
  id: string;
  dataset_name: string;
  dataset_version: string;
  total_cases: number;
  hit_rate: string;
  mean_reciprocal_rank: string;
  faithfulness: string | null;
  context_precision: string | null;
  injection_pass_rate: string;
  passed: boolean;
  created_at: Date;
};

const sourceColumns = `d.id, left(d.source, 1001) AS source, left(d.title, 1001) AS title,
  left(d.metadata ->> 'format', 16) AS format, left(d.metadata ->> 'language', 16) AS language,
  (SELECT COUNT(*)::int FROM public.chunks c WHERE c.document_id = d.id) AS chunk_count, d.updated_at`;
const passageColumns = `c.id AS chunk_id, c.ordinal, c.content,
  CASE WHEN octet_length((c.metadata -> 'security')::text) <= 1024
    THEN jsonb_build_object('security', c.metadata -> 'security') END AS security_metadata`;
const passagePredicate = `c.metadata #>> '{security,promptInjectionRisk}' = 'low'
  AND char_length(c.content) <= ${maxMcpPassageChars}`;

export class PgMcpReadRepository implements McpReadRepository {
  constructor(private readonly pool: Pool, private readonly statementTimeoutMs = 2_000) {
    if (!Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs < 1 || statementTimeoutMs > 5_000) {
      throw new Error("Workspace read statements require a timeout between 1 and 5,000 ms.");
    }
  }

  listSources(tenantId: string, limit: number, signal: AbortSignal): Promise<McpSourceRecord[]> {
    return this.read(signal, async (client) => {
      const { rows } = await client.query<SourceRow>(
        `SELECT ${sourceColumns}
         FROM (
           SELECT id, source, title, metadata, updated_at FROM public.documents
           WHERE tenant_id = $1 ORDER BY updated_at DESC, id LIMIT $2
         ) d
         ORDER BY d.updated_at DESC, d.id`,
        [tenantId, limit]
      );
      return rows.map(mapSource);
    });
  }

  getIngestionStatus(tenantId: string, jobId: string, signal: AbortSignal): Promise<McpIngestionRecord | null> {
    return this.read(signal, async (client) => {
      const { rows: [row] } = await client.query<IngestionRow>(
        `SELECT id, document_id, status, progress, chunk_count, updated_at
         FROM public.ingestion_jobs WHERE tenant_id = $1 AND id = $2`,
        [tenantId, jobId]
      );
      return row ? {
        id: row.id, documentId: row.document_id, status: row.status, progress: row.progress,
        chunkCount: row.chunk_count, updatedAt: row.updated_at
      } : null;
    });
  }

  getQualityReport(tenantId: string, limit: number, signal: AbortSignal): Promise<McpEvaluationRecord[]> {
    return this.read(signal, async (client) => {
      const { rows } = await client.query<EvaluationRow>(
        `SELECT id, left(dataset_name, 1001) AS dataset_name, left(dataset_version, 1001) AS dataset_version,
                total_cases, hit_rate, mean_reciprocal_rank, faithfulness, context_precision,
                injection_pass_rate, passed, created_at
         FROM public.evaluation_runs WHERE tenant_id = $1 ORDER BY created_at DESC, id LIMIT $2`,
        [tenantId, limit]
      );
      return rows.map((row) => ({
        id: row.id, datasetName: row.dataset_name, datasetVersion: row.dataset_version,
        totalCases: row.total_cases, hitRate: Number(row.hit_rate), meanReciprocalRank: Number(row.mean_reciprocal_rank),
        faithfulness: row.faithfulness === null ? null : Number(row.faithfulness),
        contextPrecision: row.context_precision === null ? null : Number(row.context_precision),
        injectionPassRate: Number(row.injection_pass_rate), passed: row.passed, createdAt: row.created_at
      }));
    });
  }

  getDocument(tenantId: string, documentId: string, limit: number, signal: AbortSignal) {
    return this.read(signal, async (client) => {
      const { rows: [document] } = await client.query<SourceRow>(
        `SELECT ${sourceColumns} FROM public.documents d WHERE d.tenant_id = $1 AND d.id = $2`,
        [tenantId, documentId]
      );
      if (!document) return null;
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

  private async read<Result>(signal: AbortSignal, query: (client: PoolClient) => Promise<Result>): Promise<Result> {
    signal.throwIfAborted();
    const client = await this.pool.connect();
    if (signal.aborted) {
      client.release();
      signal.throwIfAborted();
    }
    let discarded = false;
    const discard = () => {
      if (!discarded) {
        discarded = true;
        // pg evicts this checked-out connection and closes its in-flight socket.
        // The server-side timeout still bounds execution through a pooler.
        client.release(true);
      }
    };
    signal.addEventListener("abort", discard, { once: true });
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      signal.throwIfAborted();
      await client.query(
        `SELECT pg_catalog.set_config('statement_timeout', $1, true),
                pg_catalog.set_config('idle_in_transaction_session_timeout', $1, true)`,
        [`${this.statementTimeoutMs}ms`]
      );
      signal.throwIfAborted();
      const result = await query(client);
      signal.throwIfAborted();
      await client.query("COMMIT");
      signal.throwIfAborted();
      return result;
    } catch (error) {
      discard();
      signal.throwIfAborted();
      throw error;
    } finally {
      signal.removeEventListener("abort", discard);
      if (!discarded) client.release();
    }
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
