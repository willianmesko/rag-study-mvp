import { uploadJobSchema } from "@rag-study/contracts";
import { z } from "zod";
import type { IngestionJob } from "../../application/ports/ingestion-job-repository.js";
import { decodeStoredRecord } from "../../../../platform/database/stored-record.js";

const jobRowSchema = z.object({
  admission_attempts: z.number().int().nonnegative().default(0),
  id: z.uuid(), tenant_id: z.uuid(), document_id: z.uuid().nullable(),
  source: z.string(), title: z.string().nullable(), filename: z.string(), mime_type: z.string(),
  // Validate driver shape, never copy or interpret the original file here.
  payload: z.instanceof(Buffer).nullable(), storage_path: z.string().nullable(),
  status: uploadJobSchema.shape.status,
  progress: uploadJobSchema.shape.progress.pipe(z.number().int()),
  error: z.string().nullable(),
  chunk_count: uploadJobSchema.shape.chunkCount,
  high_risk_chunks: uploadJobSchema.shape.highRiskChunks,
  created_at: z.date(), updated_at: z.date(),
});
export type StoredIngestionJobRow = z.input<typeof jobRowSchema>;

export function decodeIngestionJob(value: unknown): IngestionJob {
  const row = decodeStoredRecord(jobRowSchema, value);
  return {
    admissionAttempts: row.admission_attempts,
    id: row.id, tenantId: row.tenant_id, documentId: row.document_id,
    source: row.source, title: row.title, filename: row.filename, mimeType: row.mime_type,
    payload: row.payload, storagePath: row.storage_path, status: row.status,
    progress: row.progress, error: row.error, chunkCount: row.chunk_count,
    highRiskChunks: row.high_risk_chunks, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
