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
      await this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, stage: "processing", status: "started" });
      const sourceReadStartedAt = Date.now();
      await this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, stage: "source_read", status: "started" });
      const payload = job.payload ?? await this.readStoredOriginal(job.storagePath);
      await this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, stage: "source_read", status: "completed", durationMs: Date.now() - sourceReadStartedAt, details: { bytes: payload.byteLength } });
      const extractionStartedAt = Date.now();
      await this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, stage: "text_extraction", status: "started" });
      const extracted = await this.extractor.extract({ ...job, payload });
      await this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, stage: "text_extraction", status: "completed", durationMs: Date.now() - extractionStartedAt, details: { characters: extracted.text.length } });
      const result = await this.ingest.execute(
        { tenantId: job.tenantId, source: job.source, title: job.title ?? undefined, text: extracted.text, metadata: { filename: job.filename, mimeType: job.mimeType, ingestionJobId: job.id, ...extracted.metadata } },
        (event) => this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, ...event })
      );
      await this.jobs.complete(job.id, { documentId: result.id, ...result });
      await this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, stage: "completed", status: "completed", details: { documentId: result.id, chunkCount: result.chunkCount, highRiskChunks: result.highRiskChunks } });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "Unexpected ingestion error";
      await this.jobs.fail(job.id, message);
      await this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, stage: "failed", status: "failed", details: { message } });
    }
    return true;
  }

  private async readStoredOriginal(storagePath: string | null): Promise<Buffer> {
    if (!storagePath) throw new Error("The ingestion job has no readable original file.");
    return this.originals.get(storagePath);
  }
}
