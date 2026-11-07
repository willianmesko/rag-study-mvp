import type { IngestionJob, IngestionJobEvent } from "../application/ports/ingestion-job-repository.js";

export function serializeJob(job: Omit<IngestionJob, "payload"> | IngestionJob) {
  return { id: job.id, source: job.source, title: job.title, filename: job.filename, mimeType: job.mimeType, status: job.status, progress: job.progress, error: job.error, chunkCount: job.chunkCount, highRiskChunks: job.highRiskChunks, createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString() };
}

export function serializeIngestionEvent(event: IngestionJobEvent) {
  return { id: event.id, stage: event.stage, status: event.status, durationMs: event.durationMs, details: event.details, createdAt: event.createdAt.toISOString() };
}
