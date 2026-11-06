import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentExtractionEvent } from "../../application/ports/document-text-extractor.js";
import type { IngestionJobRepository } from "../../application/ports/ingestion-job-repository.js";
import type { OriginalFileStore } from "../../application/ports/original-file-store.js";
import type { IngestDocumentUseCase } from "../../application/use-cases/ingest-document.js";
import { ProcessNextIngestionJobUseCase } from "../../application/use-cases/process-next-ingestion-job.js";
import { MultiFormatDocumentTextExtractor } from "./document-text-extractor.js";
import type { PdfOcrEngine } from "./pdf-ocr.js";
import { makePdf } from "./pdf-test-fixture.js";

function pdf(pages: ReadonlyArray<string | null>) {
  return { filename: "example.pdf", mimeType: "application/pdf", payload: makePdf(pages) };
}

function reporter() {
  const events: DocumentExtractionEvent[] = [];
  return { events, report: async (event: DocumentExtractionEvent) => { events.push(event); } };
}

test("native PDF text retains page order without OCR or generated page markers", async () => {
  const first = "The invoice terms are searchable.";
  const second = "The appendix has native text.";
  const extractor = new MultiFormatDocumentTextExtractor({
    maxOcrPages: 1,
    ocr: { async recognize() { throw new Error("Native pages should skip OCR."); } }
  });
  const { events, report } = reporter();
  const result = await extractor.extract(pdf([first, second]), report);
  assert.equal(result.text, `${first}\n\n${second}`);
  assert.equal(result.metadata.ocrUsed, false);
  assert.equal(result.metadata.pageCount, 2);
  assert.deepEqual(events, []);
});

test("mixed PDFs recognize only unreadable pages and merge out-of-order OCR results by page number", async () => {
  const { events, report } = reporter();
  const first = "This cover contains the native contract details.";
  const third = "The native appendix follows the image.";
  const second = "The scan includes delivery instructions.";
  const fourth = "The last scan has approvals.";
  const document = pdf([first, null, third, "Page 4 of 4"]);
  const ocr: PdfOcrEngine = {
    async recognize({ pdf, pageNumbers }) {
      assert.deepEqual(pdf, document.payload);
      assert.deepEqual(pageNumbers, [2, 4]);
      return { pages: [
        { pageNumber: 4, text: fourth, wordCount: 5, meanConfidence: 84 },
        { pageNumber: 2, text: second, wordCount: 6, meanConfidence: 95 }
      ] };
    }
  };

  const result = await new MultiFormatDocumentTextExtractor({ ocr, maxOcrPages: 2 }).extract(document, report);
  assert.equal(result.text, [first, second, third, fourth].join("\n\n"));
  assert.equal(result.metadata.ocrUsed, true);
  assert.deepEqual(events.map(({ stage, status, details }) => ({ stage, status, details })), [
    { stage: "ocr", status: "started", details: { totalPages: 4, requestedPages: 2 } },
    { stage: "ocr", status: "completed", details: { totalPages: 4, ocrPages: 2, wordCount: 11, meanConfidence: 90, emptyPages: 0 } }
  ]);
});

test("image-only PDFs fail with an OCR code when OCR is disabled or exceeds its page limit", async () => {
  const document = pdf([null, null]);
  const { events, report } = reporter();
  await assert.rejects(new MultiFormatDocumentTextExtractor().extract(document, report), /Enable OCR/);
  assert.deepEqual(events.at(-1)?.details, { code: "ocr_disabled" });
  let called = false;
  const limited = new MultiFormatDocumentTextExtractor({
    maxOcrPages: 1,
    ocr: { async recognize() { called = true; return { pages: [] }; } }
  });
  await assert.rejects(limited.extract(document, report), /scanned page limit/);
  assert.equal(called, false);
  assert.deepEqual(events.at(-1)?.details, { code: "ocr_page_limit" });
});

test("OCR-disabled environments retain readable native pages and record the skipped pages", async () => {
  const { events, report } = reporter();
  const native = "This searchable section is long enough to index.";
  const result = await new MultiFormatDocumentTextExtractor().extract(pdf([native, "", null]), report);
  assert.equal(result.text, native);
  assert.equal(result.metadata.ocrUsed, false);
  assert.equal(result.metadata.requiresOcr, true);
  assert.deepEqual(events, [
    { stage: "ocr", status: "info", details: { code: "ocr_disabled", totalPages: 3, requestedPages: 2 } }
  ]);
});

test("blank OCR pages are counted and cannot become indexable text", async () => {
  const { events, report } = reporter();
  const extractor = new MultiFormatDocumentTextExtractor({
    maxOcrPages: 2,
    ocr: { async recognize({ pageNumbers }) {
      return { pages: pageNumbers.map((pageNumber) => ({
        pageNumber, text: `Page ${pageNumber} of 2`, wordCount: 4, meanConfidence: 99
      })) };
    } }
  });
  await assert.rejects(extractor.extract(pdf([null, null]), report), /no usable text/);
  assert.deepEqual(events.at(-1)?.details, { code: "ocr_no_text" });

  const result = await extractor.extract(pdf(["The native page has enough searchable text.", null]), report);
  assert.equal(result.metadata.ocrEmptyPages, 1);
  assert.equal(events.at(-1)?.status, "completed");
  assert.deepEqual(events.at(-1)?.details, {
    totalPages: 2, ocrPages: 1, wordCount: 0, meanConfidence: null, emptyPages: 1
  });
});

test("incomplete and oversized OCR outputs fail without leaking OCR content", async () => {
  const document = pdf([null, null]);
  const { events, report } = reporter();
  const incomplete = new MultiFormatDocumentTextExtractor({
    maxOcrPages: 2,
    ocr: { async recognize() { return { pages: [] }; } }
  });
  await assert.rejects(incomplete.extract(document, report), /could not be read by OCR/);
  assert.deepEqual(events.at(-1)?.details, { code: "ocr_recognition_failed" });

  const oversized = new MultiFormatDocumentTextExtractor({
    maxOcrPages: 2,
    ocr: { async recognize({ pageNumbers }) {
      return { pages: pageNumbers.map((pageNumber) => ({
        pageNumber, text: "private".repeat(36_000), wordCount: 1, meanConfidence: 98
      })) };
    } }
  });
  await assert.rejects(oversized.extract(document, report), /extracted text limit/);
  assert.deepEqual(events.at(-1)?.details, { code: "ocr_output_limit" });
});

test("worker records tenant-scoped OCR events and fails the job without indexing unreadable text", async () => {
  type JobEvent = Parameters<IngestionJobRepository["recordEvent"]>[0];
  const events: JobEvent[] = [];
  let failed = false;
  const jobs = {
    async claimNext() { return { ...pdf([null, null]), id: "ocr-job", tenantId: "ocr-tenant" }; },
    async recordEvent(event: JobEvent) { events.push(event); },
    async fail(id: string, reason: string) {
      assert.equal(id, "ocr-job");
      assert.match(reason, /could not be read by OCR/);
      failed = true;
    }
  } as unknown as IngestionJobRepository;
  const extractor = new MultiFormatDocumentTextExtractor({
    maxOcrPages: 2,
    ocr: { async recognize() { throw new Error("private OCR stderr"); } }
  });
  const unusedIngest = { async execute() { assert.fail("An unreadable document must not be indexed."); } } as unknown as IngestDocumentUseCase;
  const originals = {} as OriginalFileStore;
  assert.equal(await new ProcessNextIngestionJobUseCase(jobs, extractor, unusedIngest, originals).execute(), true);
  assert.equal(failed, true);
  assert.ok(events.every(({ tenantId, jobId }) => tenantId === "ocr-tenant" && jobId === "ocr-job"));
  assert.deepEqual(events.slice(-4).map(({ stage, status }) => [stage, status]), [
    ["ocr", "started"], ["ocr", "failed"], ["text_extraction", "failed"], ["failed", "failed"]
  ]);
  assert.ok(!JSON.stringify(events).includes("private OCR stderr"));
});
