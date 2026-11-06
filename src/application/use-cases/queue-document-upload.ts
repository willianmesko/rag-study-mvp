import type { IngestionJobRepository } from "../ports/ingestion-job-repository.js";

export class QueueDocumentUploadUseCase {
  constructor(private readonly jobs: IngestionJobRepository) {}

  execute(input: { source: string; title?: string; filename: string; mimeType: string; payload: Buffer }) {
    return this.jobs.enqueue({ ...input, title: input.title ?? null });
  }
}
