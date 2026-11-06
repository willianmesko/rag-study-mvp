import type { DocumentTextExtractor } from "../ports/document-text-extractor.js";
import type { IngestionJobRepository } from "../ports/ingestion-job-repository.js";
import type { IngestDocumentUseCase } from "./ingest-document.js";

export class ProcessNextIngestionJobUseCase {
  constructor(private readonly jobs: IngestionJobRepository, private readonly extractor: DocumentTextExtractor, private readonly ingest: IngestDocumentUseCase) {}

  async execute(): Promise<boolean> {
    const job = await this.jobs.claimNext();
    if (!job) return false;
    try {
      const text = await this.extractor.extract(job);
      const result = await this.ingest.execute({ source: job.source, title: job.title ?? undefined, text, metadata: { filename: job.filename, mimeType: job.mimeType, ingestionJobId: job.id } });
      await this.jobs.complete(job.id, result);
    } catch (error) {
      await this.jobs.fail(job.id, error instanceof Error ? error.message.slice(0, 1000) : "Unexpected ingestion error");
    }
    return true;
  }
}
