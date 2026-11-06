import assert from "node:assert/strict";
import test from "node:test";
import { DeleteDocumentUseCase } from "./delete-document.js";
import { ReindexDocumentUseCase } from "./reindex-document.js";
import type { DocumentRepository } from "../ports/document-repository.js";
import type { IngestionJobRepository } from "../ports/ingestion-job-repository.js";
import type { OriginalFileStore } from "../ports/original-file-store.js";

test("reindex delegates to the stored-original ingestion job", async () => {
  const jobs = { requeueDocument: async (documentId: string, tenantId: string) => ({ id: "job-1", documentId, tenantId }) } as unknown as IngestionJobRepository;
  const result = await new ReindexDocumentUseCase(jobs).execute({ documentId: "document-1", tenantId: "tenant-1" });
  assert.deepEqual(result, { id: "job-1", documentId: "document-1", tenantId: "tenant-1" });
});

test("deletion removes the private original and job before deleting the document", async () => {
  const events: string[] = [];
  const documents = {
    replace: async () => ({ id: "unused", chunkCount: 0 }), findHybrid: async () => [], list: async () => [], listChunks: async () => [],
    delete: async () => { events.push("document"); return true; }
  } as DocumentRepository;
  const jobs = {
    listStoragePathsForDocument: async () => ["uploads/original.pdf"],
    deleteForDocument: async () => { events.push("job"); }
  } as unknown as IngestionJobRepository;
  const originals = { isEnabled: () => true, put: async () => {}, get: async () => Buffer.alloc(0), remove: async () => { events.push("original"); } } satisfies OriginalFileStore;

  const deleted = await new DeleteDocumentUseCase(documents, jobs, originals).execute({ documentId: "document-1", tenantId: "tenant-1" });
  assert.equal(deleted, true);
  assert.deepEqual(events, ["original", "job", "document"]);
});
