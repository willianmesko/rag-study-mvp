import type { IngestionJobRepository } from "../ports/ingestion-job-repository.js";
import type { OriginalFileStore } from "../ports/original-file-store.js";

export class GetDocumentOriginalUseCase {
  constructor(
    private readonly jobs: Pick<IngestionJobRepository, "findIndexedOriginal">,
    private readonly originals: Pick<OriginalFileStore, "get">
  ) {}

  async execute(input: { tenantId: string; documentId: string }): Promise<{ filename: string; mimeType: string; payload: Buffer } | null> {
    const original = await this.jobs.findIndexedOriginal(input);
    if (!original) return null;

    let payload = original.payload;
    if (payload === null && original.storagePath) {
      try {
        payload = await this.originals.get(original.storagePath);
      } catch {
        throw new Error("Unable to read the stored original file.");
      }
    }

    return payload === null ? null : { filename: original.filename, mimeType: original.mimeType, payload };
  }
}
