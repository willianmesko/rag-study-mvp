import { randomUUID } from "node:crypto";
import type { IngestionJobRepository } from "../ports/ingestion-job-repository.js";
import type { OriginalFileStore } from "../ports/original-file-store.js";

export class QueueDocumentUploadUseCase {
  constructor(private readonly jobs: IngestionJobRepository, private readonly originals: OriginalFileStore) {}

  async execute(input: { source: string; title?: string; filename: string; mimeType: string; payload: Buffer }) {
    if (!this.originals.isEnabled()) {
      return this.jobs.enqueue({ ...input, title: input.title ?? null, storagePath: null });
    }

    const storagePath = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeFilename(input.filename)}`;
    await this.originals.put({ path: storagePath, contentType: input.mimeType, payload: input.payload });
    try {
      return await this.jobs.enqueue({ ...input, title: input.title ?? null, payload: null, storagePath });
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
