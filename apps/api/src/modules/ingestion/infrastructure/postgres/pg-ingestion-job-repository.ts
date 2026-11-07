import { currentExecution } from "../../../../platform/workflows/execution-context.js";
import { WorkflowGuardError } from "../../../../platform/workflows/types.js";
import { lockWorkflowFence } from "../../../../platform/database/workflow-fence.js";
import type { Pool, PoolClient } from "pg";
import {
  ExistingIngestionSourceError,
  UploadAdmissionError,
  type EnqueueOptions,
} from "../../application/ports/ingestion-job-repository.js";
import { withWorkspaceLock } from "../../../../platform/database/workspace-embedding-lock.js";
import type {
  IndexedOriginal,
  IngestionJob,
  IngestionJobEvent,
  IngestionJobRepository,
  IngestionPassagePreview,
} from "../../application/ports/ingestion-job-repository.js";
import { indexedOriginalPredicate } from "../../../../platform/database/indexed-original.js";
import { readStoredChunkSecurity } from "../../../../platform/database/stored-chunk-security.js";

type Row = {
  admission_attempts?: number;
  id: string;
  tenant_id: string;
  document_id: string | null;
  source: string;
  title: string | null;
  filename: string;
  mime_type: string;
  payload: Buffer | null;
  storage_path: string | null;
  status: IngestionJob["status"];
  progress: number;
  error: string | null;
  chunk_count: number | null;
  high_risk_chunks: number | null;
  created_at: Date;
  updated_at: Date;
};
const columns =
  "admission_attempts, id, tenant_id, document_id, source, title, filename, mime_type, payload, storage_path, status, progress, error, chunk_count, high_risk_chunks, created_at, updated_at";
const map = (row: Row): IngestionJob => ({
  admissionAttempts: row.admission_attempts ?? 0,
  id: row.id,
  tenantId: row.tenant_id,
  documentId: row.document_id,
  source: row.source,
  title: row.title,
  filename: row.filename,
  mimeType: row.mime_type,
  payload: row.payload,
  storagePath: row.storage_path,
  status: row.status,
  progress: row.progress,
  error: row.error,
  chunkCount: row.chunk_count,
  highRiskChunks: row.high_risk_chunks,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
type EventRow = {
  id: string;
  job_id: string;
  stage: string;
  status: IngestionJobEvent["status"];
  duration_ms: number | null;
  details: Record<string, unknown>;
  created_at: Date;
};
const mapEvent = (row: EventRow): IngestionJobEvent => ({
  id: row.id,
  jobId: row.job_id,
  stage: row.stage,
  status: row.status,
  durationMs: row.duration_ms,
  details: row.details,
  createdAt: row.created_at,
});
type PassagePreviewRow = { total_chunks: number } & (
  | { chunk_id: null; ordinal: null; content: null; metadata: null }
  | { chunk_id: string; ordinal: number; content: string; metadata: unknown }
);

export class PgIngestionJobRepository implements IngestionJobRepository {
  constructor(private readonly pool: Pool) {}
  async readForProcessing(jobId: string, tenantId: string) {
    const r = await this.pool.query<Row>(
      `SELECT ${columns} FROM ingestion_jobs WHERE id=$1 AND tenant_id=$2`,
      [jobId, tenantId],
    );
    return r.rows[0] ? map(r.rows[0]) : null;
  }
  async findIdempotent(
    tenantId: string,
    admission: { keyHash: string; requestHash: string },
  ) {
    const result = await this.pool.query<Row & { request_hash: string }>(
      `SELECT ${columns},request_hash FROM ingestion_jobs WHERE tenant_id=$1 AND idempotency_key_hash=$2`,
      [tenantId, admission.keyHash],
    );
    if (result.rows[0] && result.rows[0].request_hash !== admission.requestHash)
      throw new UploadAdmissionError("idempotency_conflict");
    return result.rows[0] ? map(result.rows[0]) : null;
  }
  async usesStoragePath(tenantId: string, path: string) {
    return Boolean(
      (
        await this.pool.query(
          "SELECT 1 FROM ingestion_jobs WHERE tenant_id=$1 AND storage_path=$2 LIMIT 1",
          [tenantId, path],
        )
      ).rowCount,
    );
  }
  async enqueue(
    input: Parameters<IngestionJobRepository["enqueue"]>[0],
    options?: EnqueueOptions,
  ) {
    return withWorkspaceLock(
      this.pool,
      input.tenantId,
      "exclusive",
      async (client) => {
        const admission = options?.admission;
        if (admission) {
          const previous = await client.query<Row & { request_hash: string }>(
            `SELECT ${columns},request_hash FROM ingestion_jobs WHERE tenant_id=$1 AND idempotency_key_hash=$2`,
            [input.tenantId, admission.keyHash],
          );
          if (previous.rows[0]) {
            if (previous.rows[0].request_hash !== admission.requestHash)
              throw new UploadAdmissionError("idempotency_conflict");
            return map(previous.rows[0]);
          }
        }
        if (options?.onlyIfMissing) {
          const document = await client.query<{ id: string }>(
            "SELECT id FROM documents WHERE tenant_id=$1 AND source=$2",
            [input.tenantId, input.source],
          );
          if (document.rows[0])
            throw new ExistingIngestionSourceError(
              input.source,
              "ready",
              document.rows[0].id,
              null,
            );
          const pending = await client.query<{
            id: string;
            status: "queued" | "processing";
          }>(
            "SELECT id,status FROM ingestion_jobs WHERE tenant_id=$1 AND source=$2 AND status IN ('queued','processing') ORDER BY created_at DESC LIMIT 1",
            [input.tenantId, input.source],
          );
          if (pending.rows[0])
            throw new ExistingIngestionSourceError(
              input.source,
              pending.rows[0].status,
              null,
              pending.rows[0].id,
            );
        }
        if (admission?.quota) {
          const quota = admission.quota;
          if (
            !Number.isSafeInteger(quota.bytes) ||
            quota.bytes < 1 ||
            !Number.isSafeInteger(quota.limit) ||
            quota.limit < 1
          )
            throw new UploadAdmissionError("upload_quota_exceeded");
          const used = await client.query(
            `INSERT INTO tenant_daily_usage(tenant_id,actor_key,uploaded_bytes)
          SELECT $1,$2,$3::bigint WHERE $3::bigint<=$4::bigint
          ON CONFLICT(tenant_id,actor_key,usage_date) DO UPDATE SET uploaded_bytes=tenant_daily_usage.uploaded_bytes+excluded.uploaded_bytes,updated_at=NOW()
          WHERE tenant_daily_usage.uploaded_bytes+excluded.uploaded_bytes<=$4::bigint RETURNING uploaded_bytes`,
            [input.tenantId, quota.actorKey, quota.bytes, quota.limit],
          );
          if (!used.rowCount)
            throw new UploadAdmissionError("upload_quota_exceeded");
        }
        const result = await client.query<Row>(
          `INSERT INTO ingestion_jobs(tenant_id,source,title,filename,mime_type,payload,storage_path,idempotency_key_hash,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${columns}`,
          [
            input.tenantId,
            input.source,
            input.title,
            input.filename,
            input.mimeType,
            input.payload,
            input.storagePath,
            admission?.keyHash ?? null,
            admission?.requestHash ?? null,
          ],
        );
        const job = map(result.rows[0]!);
        await client.query(
          "INSERT INTO ingestion_job_events(job_id,tenant_id,stage,status,details) VALUES($1,$2,'queued','completed',$3::jsonb)",
          [
            job.id,
            job.tenantId,
            JSON.stringify({
              storage: input.storagePath
                ? "private_object_storage"
                : "database",
            }),
          ],
        );
        return job;
      },
    );
  }
  async deferAdmission(id: string, reason: string, delayMs: number) {
    const r = await this.pool.query(
      `UPDATE ingestion_jobs SET status=CASE WHEN admission_attempts>=8 THEN 'failed' ELSE 'queued' END,
      error=$2,available_at=clock_timestamp()+$3*interval '1 millisecond',updated_at=clock_timestamp() WHERE id=$1 AND status='processing' RETURNING status,tenant_id`,
      [id, reason, Math.min(3600000, Math.max(0, delayMs))],
    );
    if (r.rows[0])
      await this.recordEvent({
        jobId: id,
        tenantId: r.rows[0].tenant_id,
        stage: "admission",
        status: r.rows[0].status === "failed" ? "failed" : "info",
        details: { reason },
      });
    return Boolean(r.rowCount);
  }
  async claimNext() {
    await this.pool
      .query(`WITH exhausted AS(UPDATE ingestion_jobs j SET status='failed',error='admission_attempts_exhausted',updated_at=clock_timestamp()
      WHERE admission_attempts>=8 AND status='processing' AND updated_at<clock_timestamp()-interval '10 minutes'
      AND NOT EXISTS(SELECT 1 FROM workflow_runs r WHERE r.tenant_id=j.tenant_id AND r.run_id=j.id AND r.status IN ('queued','running','waiting_approval')) RETURNING id,tenant_id)
      INSERT INTO ingestion_job_events(job_id,tenant_id,stage,status,details) SELECT id,tenant_id,'admission','failed','{"reason":"admission_attempts_exhausted"}'::jsonb FROM exhausted`);
    const result = await this.pool
      .query<Row>(`WITH candidate AS (SELECT j.id FROM ingestion_jobs j WHERE
      admission_attempts<8 AND available_at<=clock_timestamp()
      AND (status='queued' OR (status='processing' AND updated_at<clock_timestamp()-interval '10 minutes'))
      AND NOT EXISTS(SELECT 1 FROM workflow_runs r WHERE r.tenant_id=j.tenant_id AND r.run_id=j.id AND r.kind='ingestion' AND r.status IN ('queued','running','waiting_approval'))
      ORDER BY created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1)
      UPDATE ingestion_jobs j SET status='processing',admission_attempts=admission_attempts+1,progress=20,error=NULL,updated_at=NOW() FROM candidate WHERE j.id=candidate.id RETURNING j.*`);
    return result.rows[0] ? map(result.rows[0]) : null;
  }
  private async guarded<T>(
    tenantId: string,
    work: (client: Pool | PoolClient) => Promise<T>,
  ) {
    if (!currentExecution()) return work(this.pool);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockWorkflowFence(client, tenantId);
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async complete(
    id: string,
    result: { documentId: string; chunkCount: number; highRiskChunks: number },
  ) {
    const execution = currentExecution();
    await this.guarded(execution?.lease.tenantId ?? "", async (client) => {
      const updated = await client.query(
        "UPDATE ingestion_jobs SET document_id=$2, status='completed', progress=100, chunk_count=$3, high_risk_chunks=$4, payload=CASE WHEN storage_path IS NULL THEN payload ELSE NULL END, updated_at=NOW() WHERE id=$1 AND status IN ('processing','completed')",
        [id, result.documentId, result.chunkCount, result.highRiskChunks],
      );
      if (execution && !updated.rowCount)
        throw new WorkflowGuardError("cancelled");
    });
  }
  async cancel(id: string, tenantId: string) {
    const result = await this.pool.query(
      "UPDATE ingestion_jobs SET status='failed', progress=100, error='execution_cancelled', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status IN ('queued','processing')",
      [id, tenantId],
    );
    return result.rowCount === 1;
  }
  // Keep a failed payload/object reference so the job can safely be retried.
  async fail(id: string, error: string) {
    await this.pool.query(
      "UPDATE ingestion_jobs SET status='failed', progress=100, error=$2, updated_at=NOW() WHERE id=$1 AND status IN ('queued','processing')",
      [id, error],
    );
  }
  async retry(id: string, tenantId: string) {
    const result = await this.pool.query(
      "UPDATE ingestion_jobs SET status='queued', progress=0, error=NULL, admission_attempts=0, available_at=clock_timestamp(), updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status='failed'",
      [id, tenantId],
    );
    return result.rowCount === 1;
  }
  async list(tenantId: string, limit: number) {
    const result = await this.pool.query<Row>(
      `SELECT ${columns.replace("payload, ", "")} FROM ingestion_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [tenantId, limit],
    );
    return result.rows.map(({ payload: _payload, ...row }) =>
      map({ ...row, payload: null }),
    );
  }
  async previewPassages(input: {
    jobId: string;
    tenantId: string;
  }): Promise<IngestionPassagePreview | null> {
    const result = await this.pool.query<PassagePreviewRow>(
      `SELECT COALESCE(j.chunk_count, (SELECT COUNT(*)::int FROM chunks WHERE document_id = d.id)) AS total_chunks,
              c.id AS chunk_id, c.ordinal, c.content, c.metadata
       FROM ingestion_jobs j
       JOIN documents d ON d.id = j.document_id AND d.tenant_id = j.tenant_id AND d.source = j.source
         AND d.metadata ->> 'ingestionJobId' = j.id::text
       LEFT JOIN LATERAL (
         SELECT id, ordinal, content, metadata
         FROM chunks
         WHERE document_id = d.id
         ORDER BY ordinal
         LIMIT 3
       ) c ON TRUE
       WHERE j.id = $1 AND j.tenant_id = $2 AND j.status = 'completed'
       ORDER BY c.ordinal`,
      [input.jobId, input.tenantId],
    );
    const first = result.rows[0];
    if (!first) return null;
    return {
      totalChunks: first.total_chunks,
      passages: result.rows.flatMap((row) =>
        row.chunk_id === null
          ? []
          : [
              {
                chunkId: row.chunk_id,
                ordinal: row.ordinal,
                content: row.content,
                security: readStoredChunkSecurity(row.metadata),
              },
            ],
      ),
    };
  }

  async findIndexedOriginal(input: {
    documentId: string;
    tenantId: string;
  }): Promise<IndexedOriginal | null> {
    const result = await this.pool.query<
      Pick<Row, "filename" | "mime_type" | "payload" | "storage_path">
    >(
      `SELECT j.filename, j.mime_type, j.payload, j.storage_path
       FROM documents d
       JOIN ingestion_jobs j ON ${indexedOriginalPredicate}
       WHERE d.tenant_id = $1 AND d.id = $2`,
      [input.tenantId, input.documentId],
    );
    const row = result.rows[0];
    return row
      ? {
          filename: row.filename,
          mimeType: row.mime_type,
          payload: row.payload,
          storagePath: row.storage_path,
        }
      : null;
  }

  async requeueDocument(
    documentId: string,
    tenantId: string,
  ): Promise<IngestionJob | null> {
    const result = await this.pool.query<Row>(
      `INSERT INTO ingestion_jobs (tenant_id,document_id,source,title,filename,mime_type,payload,storage_path)
       SELECT j.tenant_id,d.id,j.source,j.title,j.filename,j.mime_type,j.payload,j.storage_path
       FROM documents d JOIN ingestion_jobs j ON ${indexedOriginalPredicate}
       WHERE d.tenant_id=$1 AND d.id=$2 AND j.status='completed'
       RETURNING ${columns}`,
      [tenantId, documentId],
    );
    return result.rows[0] ? map(result.rows[0]) : null;
  }
  async listStoragePathsForDocument(
    documentId: string,
    tenantId: string,
  ): Promise<string[]> {
    const result = await this.pool.query<{ storage_path: string }>(
      "SELECT storage_path FROM ingestion_jobs WHERE tenant_id = $1 AND document_id = $2 AND storage_path IS NOT NULL",
      [tenantId, documentId],
    );
    return result.rows.map((row) => row.storage_path);
  }
  async deleteForDocument(documentId: string, tenantId: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM ingestion_jobs WHERE tenant_id = $1 AND document_id = $2",
      [tenantId, documentId],
    );
  }
  async recordEvent(input: {
    jobId: string;
    tenantId: string;
    stage: string;
    status: IngestionJobEvent["status"];
    durationMs?: number | null;
    details?: Record<string, unknown>;
  }): Promise<void> {
    await this.guarded(input.tenantId, async (client) => {
      if (currentExecution()) {
        const job = await client.query(
          "SELECT 1 FROM ingestion_jobs WHERE tenant_id=$1 AND id=$2 AND status IN ('processing','completed') FOR SHARE",
          [input.tenantId, input.jobId],
        );
        if (!job.rowCount) throw new WorkflowGuardError("cancelled");
      }
      await client.query(
        "INSERT INTO ingestion_job_events (job_id, tenant_id, stage, status, duration_ms, details) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
        [
          input.jobId,
          input.tenantId,
          input.stage,
          input.status,
          input.durationMs ?? null,
          JSON.stringify(input.details ?? {}),
        ],
      );
    });
  }

  async listEvents(
    jobId: string,
    tenantId: string,
    limit: number,
  ): Promise<IngestionJobEvent[]> {
    const result = await this.pool.query<EventRow>(
      "SELECT id, job_id, stage, status, duration_ms, details, created_at FROM ingestion_job_events WHERE job_id = $1 AND tenant_id = $2 ORDER BY created_at ASC LIMIT $3",
      [jobId, tenantId, limit],
    );
    return result.rows.map(mapEvent);
  }
}
