import type { Pool } from "pg";
import type { IngestionJob, IngestionJobEvent, IngestionJobRepository } from "../../application/ports/ingestion-job-repository.js";

type Row = { id: string; tenant_id: string; document_id: string | null; source: string; title: string | null; filename: string; mime_type: string; payload: Buffer | null; storage_path: string | null; status: IngestionJob["status"]; progress: number; error: string | null; chunk_count: number | null; high_risk_chunks: number | null; created_at: Date; updated_at: Date };
const columns = "id, tenant_id, document_id, source, title, filename, mime_type, payload, storage_path, status, progress, error, chunk_count, high_risk_chunks, created_at, updated_at";
const map = (row: Row): IngestionJob => ({ id: row.id, tenantId: row.tenant_id, documentId: row.document_id, source: row.source, title: row.title, filename: row.filename, mimeType: row.mime_type, payload: row.payload, storagePath: row.storage_path, status: row.status, progress: row.progress, error: row.error, chunkCount: row.chunk_count, highRiskChunks: row.high_risk_chunks, createdAt: row.created_at, updatedAt: row.updated_at });
type EventRow = { id: string; job_id: string; stage: string; status: IngestionJobEvent["status"]; duration_ms: number | null; details: Record<string, unknown>; created_at: Date };
const mapEvent = (row: EventRow): IngestionJobEvent => ({ id: row.id, jobId: row.job_id, stage: row.stage, status: row.status, durationMs: row.duration_ms, details: row.details, createdAt: row.created_at });

export class PgIngestionJobRepository implements IngestionJobRepository {
  constructor(private readonly pool: Pool) {}
  async enqueue(input: Omit<IngestionJob, "id" | "status" | "progress" | "error" | "chunkCount" | "highRiskChunks" | "createdAt" | "updatedAt">) {
    const result = await this.pool.query<Row>(`INSERT INTO ingestion_jobs (tenant_id, source, title, filename, mime_type, payload, storage_path) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${columns}`, [input.tenantId, input.source, input.title, input.filename, input.mimeType, input.payload, input.storagePath]);
    return map(result.rows[0] as Row);
  }
  async claimNext() {
    const result = await this.pool.query<Row>(`WITH candidate AS (SELECT id FROM ingestion_jobs WHERE status = 'queued' OR (status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE ingestion_jobs j SET status='processing', progress=20, error=NULL, updated_at=NOW() FROM candidate WHERE j.id=candidate.id RETURNING j.id, j.tenant_id, j.document_id, j.source, j.title, j.filename, j.mime_type, j.payload, j.storage_path, j.status, j.progress, j.error, j.chunk_count, j.high_risk_chunks, j.created_at, j.updated_at`);
    return result.rows[0] ? map(result.rows[0]) : null;
  }
  async complete(id: string, result: { documentId: string; chunkCount: number; highRiskChunks: number }) {
    // Keep payload only when no object store is configured; otherwise Storage is
    // the durable original used for future reindexing.
    await this.pool.query(
      "UPDATE ingestion_jobs SET document_id=$2, status='completed', progress=100, chunk_count=$3, high_risk_chunks=$4, payload=CASE WHEN storage_path IS NULL THEN payload ELSE NULL END, updated_at=NOW() WHERE id=$1",
      [id, result.documentId, result.chunkCount, result.highRiskChunks]
    );
  }
  // Keep a failed payload/object reference so the job can safely be retried.
  async fail(id: string, error: string) { await this.pool.query("UPDATE ingestion_jobs SET status='failed', progress=100, error=$2, updated_at=NOW() WHERE id=$1", [id, error]); }
  async retry(id: string, tenantId: string) {
    const result = await this.pool.query("UPDATE ingestion_jobs SET status='queued', progress=0, error=NULL, updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status='failed'", [id, tenantId]);
    return result.rowCount === 1;
  }
  async list(tenantId: string, limit: number) { const result = await this.pool.query<Row>(`SELECT ${columns.replace("payload, ", "")} FROM ingestion_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2`, [tenantId, limit]); return result.rows.map(({ payload: _payload, ...row }) => map({ ...row, payload: null })); }
  async requeueDocument(documentId: string, tenantId: string): Promise<IngestionJob | null> {
    const result = await this.pool.query<Row>(
      `WITH candidate AS (
         SELECT id FROM ingestion_jobs
         WHERE tenant_id = $1 AND document_id = $2 AND status = 'completed'
           AND (payload IS NOT NULL OR storage_path IS NOT NULL)
         ORDER BY updated_at DESC
         LIMIT 1
       )
       UPDATE ingestion_jobs j
       SET status = 'queued', progress = 0, error = NULL, chunk_count = NULL, high_risk_chunks = NULL, updated_at = NOW()
       FROM candidate
       WHERE j.id = candidate.id
       RETURNING ${columns.split(", ").map((column) => `j.${column}`).join(", ")}`,
      [tenantId, documentId]
    );
    return result.rows[0] ? map(result.rows[0]) : null;
  }
  async listStoragePathsForDocument(documentId: string, tenantId: string): Promise<string[]> {
    const result = await this.pool.query<{ storage_path: string }>(
      "SELECT storage_path FROM ingestion_jobs WHERE tenant_id = $1 AND document_id = $2 AND storage_path IS NOT NULL",
      [tenantId, documentId]
    );
    return result.rows.map((row) => row.storage_path);
  }
  async deleteForDocument(documentId: string, tenantId: string): Promise<void> {
    await this.pool.query("DELETE FROM ingestion_jobs WHERE tenant_id = $1 AND document_id = $2", [tenantId, documentId]);
  }
  async recordEvent(input: { jobId: string; tenantId: string; stage: string; status: IngestionJobEvent["status"]; durationMs?: number | null; details?: Record<string, unknown> }): Promise<void> {
    await this.pool.query(
      "INSERT INTO ingestion_job_events (job_id, tenant_id, stage, status, duration_ms, details) VALUES ($1, $2, $3, $4, $5, $6::jsonb)",
      [input.jobId, input.tenantId, input.stage, input.status, input.durationMs ?? null, JSON.stringify(input.details ?? {})]
    );
  }
  async listEvents(jobId: string, tenantId: string, limit: number): Promise<IngestionJobEvent[]> {
    const result = await this.pool.query<EventRow>(
      "SELECT id, job_id, stage, status, duration_ms, details, created_at FROM ingestion_job_events WHERE job_id = $1 AND tenant_id = $2 ORDER BY created_at ASC LIMIT $3",
      [jobId, tenantId, limit]
    );
    return result.rows.map(mapEvent);
  }
}
