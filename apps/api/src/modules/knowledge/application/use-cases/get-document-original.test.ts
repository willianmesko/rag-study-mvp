import assert from "node:assert/strict";
import test from "node:test";
import { GetDocumentOriginalUseCase } from "./get-document-original.js";

const document = { tenantId: "tenant-1", documentId: "document-1" };
const file = { filename: "Reference.pdf", mimeType: "application/pdf" };

test("the original file is scoped to the requested document and workspace", async () => {
  const useCase = new GetDocumentOriginalUseCase(
    { findIndexedOriginal: async (input) => { assert.deepEqual(input, document); return null; } },
    { get: async () => assert.fail("Storage must not be called without a matching original") }
  );

  assert.equal(await useCase.execute(document), null);
});

test("a legacy original is read directly from the ingestion row", async () => {
  const payload = Buffer.from("legacy original");
  const useCase = new GetDocumentOriginalUseCase(
    { findIndexedOriginal: async () => ({ ...file, payload, storagePath: null }) },
    { get: async () => assert.fail("A legacy original does not need object storage") }
  );

  assert.deepEqual(await useCase.execute(document), { ...file, payload });
});

test("a private original is read with its server-side storage reference", async () => {
  const storagePath = "uploads/object-key.pdf";
  const payload = Buffer.from("private original");
  const useCase = new GetDocumentOriginalUseCase(
    { findIndexedOriginal: async () => ({ ...file, payload: null, storagePath }) },
    { get: async (path) => { assert.equal(path, storagePath); return payload; } }
  );

  assert.deepEqual(await useCase.execute(document), { ...file, payload });
});

test("storage failures do not expose private references or provider errors", async () => {
  const useCase = new GetDocumentOriginalUseCase(
    { findIndexedOriginal: async () => ({ ...file, payload: null, storagePath: "uploads/internal-key.pdf" }) },
    { get: async (path) => { throw new Error(`Private storage error for ${path}`); } }
  );

  await assert.rejects(useCase.execute(document), { message: "Unable to read the stored original file." });
});
