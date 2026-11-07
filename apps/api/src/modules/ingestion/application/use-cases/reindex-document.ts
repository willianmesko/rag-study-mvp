import type { IngestionJob, IngestionJobRepository } from "../ports/ingestion-job-repository.js";

export class ReindexDocumentUseCase {
  constructor(private readonly jobs: IngestionJobRepository) {}

  async execute(input: { documentId: string; tenantId: string }): Promise<IngestionJob | null> {
    const job = await this.jobs.requeueDocument(input.documentId, input.tenantId);
    if (job) await this.jobs.recordEvent({ jobId: job.id, tenantId: input.tenantId, stage: "queued", status: "info", details: { reason: "reindex" } });
    return job;
  }
}
