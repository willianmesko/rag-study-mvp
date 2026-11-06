import type { IngestionJob, IngestionJobRepository } from "../ports/ingestion-job-repository.js";

export class ReindexDocumentUseCase {
  constructor(private readonly jobs: IngestionJobRepository) {}

  async execute(input: { documentId: string; tenantId: string }): Promise<IngestionJob | null> {
    return this.jobs.requeueDocument(input.documentId, input.tenantId);
  }
}
