import type { Pool } from "pg";
import type { IngestionJob, IngestionJobRepository } from "../../application/ports/ingestion-job-repository.js";

type Row = { id: string; source: string; title: string | null; filename: string; mime_type: string; payload: Buffer; status: IngestionJob["status"]; progress: number; error: string | null; chunk_count: number | null; high_risk_chunks: number | null; created_at: Date; updated_at: Date };
const columns = "id, source, title, filename, mime_type, payload, status, progress, error, chunk_count, high_risk_chunks, created_at, updated_at";
const map = (row: Row): IngestionJob => ({ id: row.id, source: row.source, title: row.title, filename: row.filename, mimeType: row.mime_type, payload: row.payload, status: row.status, progress: row.progress, error: row.error, chunkCount: row.chunk_count, highRiskChunks: row.high_risk_chunks, createdAt: row.created_at, updatedAt: row.updated_at });

export class PgIngestionJobRepository implements IngestionJobRepository {
  constructor(private readonly pool: Pool) {}
  async enqueue(input: Omit<IngestionJob, "id" | "status" | "progress" | "error" | "chunkCount" | "highRiskChunks" | "createdAt" | "updatedAt">) {
    const result = await this.pool.query<Row>(`INSERT INTO ingestion_jobs (source, title, filename, mime_type, payload) VALUES ($1,$2,$3,$4,$5) RETURNING ${columns}`, [input.source, input.title, input.filename, input.mimeType, input.payload]);
    return map(result.rows[0] as Row);
  }
  async claimNext() {
    const result = await this.pool.query<Row>(`WITH candidate AS (SELECT id FROM ingestion_jobs WHERE status = 'queued' OR (status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE ingestion_jobs j SET status='processing', progress=20, error=NULL, updated_at=NOW() FROM candidate WHERE j.id=candidate.id RETURNING j.id, j.source, j.title, j.filename, j.mime_type, j.payload, j.status, j.progress, j.error, j.chunk_count, j.high_risk_chunks, j.created_at, j.updated_at`);
    return result.rows[0] ? map(result.rows[0]) : null;
  }
  async complete(id: string, result: { chunkCount: number; highRiskChunks: number }) { await this.pool.query("UPDATE ingestion_jobs SET status='completed', progress=100, chunk_count=$2, high_risk_chunks=$3, payload=NULL, updated_at=NOW() WHERE id=$1", [id, result.chunkCount, result.highRiskChunks]); }
  async fail(id: string, error: string) { await this.pool.query("UPDATE ingestion_jobs SET status='failed', progress=100, error=$2, payload=NULL, updated_at=NOW() WHERE id=$1", [id, error]); }
  async list(limit: number) { const result = await this.pool.query<Row>(`SELECT ${columns.replace("payload, ", "")} FROM ingestion_jobs ORDER BY created_at DESC LIMIT $1`, [limit]); return result.rows.map(({ payload: _payload, ...row }) => map({ ...row, payload: Buffer.alloc(0) })); }
}
