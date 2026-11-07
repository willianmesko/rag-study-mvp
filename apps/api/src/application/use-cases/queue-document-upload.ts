import { randomUUID } from "node:crypto";
import type { IngestionJobRepository } from "../ports/ingestion-job-repository.js";
import type { OriginalFileStore } from "../ports/original-file-store.js";

export class QueueDocumentUploadUseCase {
  constructor(private readonly jobs: IngestionJobRepository, private readonly originals: OriginalFileStore) {}

  async execute({ onlyIfMissing, ...input }: { tenantId: string; source: string; title?: string; filename: string; mimeType: string; payload: Buffer; onlyIfMissing?: true }) {
    const options = onlyIfMissing ? { onlyIfMissing } : undefined;
    if (!this.originals.isEnabled()) {
      const job = await this.jobs.enqueue({ ...input, title: input.title ?? null, storagePath: null }, options);
      await this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, stage: "queued", status: "completed", details: { storage: "database" } });
      return job;
    }

    const storagePath = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeFilename(input.filename)}`;
    await this.originals.put({ path: storagePath, contentType: input.mimeType, payload: input.payload });
    try {
      const job = await this.jobs.enqueue({ ...input, title: input.title ?? null, payload: null, storagePath }, options);
      await this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, stage: "queued", status: "completed", details: { storage: "private_object_storage" } });
      return job;
    } catch (error) {
      await this.originals.remove(storagePath);
      throw error;
    }
  }
}

function safeFilename(filename: string): string {
  const normalized = filename.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "").slice(0, 120) || "upload";
}
