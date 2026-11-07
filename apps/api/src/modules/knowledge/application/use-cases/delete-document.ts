import type { DocumentRepository } from "../ports/document-repository.js";
import type { IngestionJobRepository } from "../../../ingestion/index.js";
import type { OriginalFileStore } from "../ports/original-file-store.js";

export class DeleteDocumentUseCase {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly jobs: IngestionJobRepository,
    private readonly originals: OriginalFileStore
  ) {}

  async execute(input: { documentId: string; tenantId: string }): Promise<boolean> {
    // Remove the private original before its job reference disappears. The
    // database deletion cascades to chunks, so the corpus copy is removed too.
    const paths = await this.jobs.listStoragePathsForDocument(input.documentId, input.tenantId);
    for (const path of paths) await this.originals.remove(path);
    await this.jobs.deleteForDocument(input.documentId, input.tenantId);
    return this.documents.delete(input);
  }
}
