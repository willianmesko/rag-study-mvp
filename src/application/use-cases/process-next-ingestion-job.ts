import type { DocumentTextExtractor } from "../ports/document-text-extractor.js";
import type { IngestionJobRepository } from "../ports/ingestion-job-repository.js";
import type { OriginalFileStore } from "../ports/original-file-store.js";
import type { IngestDocumentUseCase } from "./ingest-document.js";

export class ProcessNextIngestionJobUseCase {
  constructor(private readonly jobs: IngestionJobRepository, private readonly extractor: DocumentTextExtractor, private readonly ingest: IngestDocumentUseCase, private readonly originals: OriginalFileStore) {}

  async execute(): Promise<boolean> {
    const job = await this.jobs.claimNext();
    if (!job) return false;
    try {
      const payload = job.payload ?? await this.readStoredOriginal(job.storagePath);
      const text = await this.extractor.extract({ ...job, payload });
      const result = await this.ingest.execute({ tenantId: job.tenantId, source: job.source, title: job.title ?? undefined, text, metadata: { filename: job.filename, mimeType: job.mimeType, ingestionJobId: job.id } });
      await this.jobs.complete(job.id, result);
    } catch (error) {
      await this.jobs.fail(job.id, error instanceof Error ? error.message.slice(0, 1000) : "Unexpected ingestion error");
    }
    return true;
  }

  private async readStoredOriginal(storagePath: string | null): Promise<Buffer> {
    if (!storagePath) throw new Error("The ingestion job has no readable original file.");
    return this.originals.get(storagePath);
  }
}
