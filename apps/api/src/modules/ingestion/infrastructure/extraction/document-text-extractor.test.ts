import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentExtractionEvent } from "../../application/ports/document-text-extractor.js";
import type { DocumentRepository } from "../../../knowledge/application/ports/document-repository.js";
import type { IngestionJobRepository } from "../../application/ports/ingestion-job-repository.js";
import type { OriginalFileStore } from "../../../knowledge/application/ports/original-file-store.js";
import { IngestDocumentUseCase } from "../../application/use-cases/ingest-document.js";
import { ProcessNextIngestionJobUseCase } from "../../application/use-cases/process-next-ingestion-job.js";
import { detectDocumentLanguage } from "./document-language.js";
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
  assert.deepEqual(result.sections, [{ text: first }, { text: second }]);
  assert.equal(result.metadata.ocrUsed, false);
  assert.equal(result.metadata.pageCount, 2);
  assert.equal(result.metadata.sectionCount, 2);
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

function textDocument(text: string, filename: string, mimeType: string) {
  return { filename, mimeType, payload: Buffer.from(text) };
}

test("static HTML extracts the main headings, paragraphs, entities and bounded metadata", async () => {
  const html = `<!doctype html><html lang="en-US"><head><title>People &amp; policy</title>
    <meta name="description" content="A guide for the whole team. ${"x".repeat(1_000)}"></head><body>
    <header>site banner</header><nav>global navigation</nav><main>
    <h1>Workplace <em>guidance</em></h1><p>Use the policy for your team &copy; 2026.</p>
    <p>Ask your manager &#x2014; or contact support.</p>
    <h2>Escalation</h2><p>Start with the help desk and review the result.</p>
    <script>hidden script</script><style>hidden css</style><form>hidden form</form>
    <div aria-hidden="true">hidden aria</div><div style="display: none !important;">hidden css rule</div>
    <iframe>hidden embed</iframe><template>hidden template</template><!-- hidden comment -->
    </main><footer>website footer</footer></body></html>`;
  const result = await new MultiFormatDocumentTextExtractor().extract(textDocument(html, "imported", "Text/HTML; charset=utf-8"));

  assert.equal(result.title, "People & policy");
  assert.deepEqual(result.sections, [
    { heading: "Workplace guidance", text: "Use the policy for your team © 2026.\n\nAsk your manager — or contact support." },
    { heading: "Escalation", text: "Start with the help desk and review the result." }
  ]);
  assert.equal(result.metadata.format, "html");
  assert.equal(result.metadata.language, "en");
  assert.equal(result.metadata.languageHint, "en-us");
  assert.equal(result.metadata.sectionCount, 2);
  assert.equal(String(result.metadata.description).length, 1_000);
  assert.doesNotMatch(result.text, /hidden|website footer|global navigation|site banner/);
});

test("HTML rejects parser depth, section count and input size limits without exposing content", async () => {
  const extractor = new MultiFormatDocumentTextExtractor();
  const extract = (html: string) => extractor.extract(textDocument(html, "example.html", "text/html"));
  await assert.rejects(extract("<div>".repeat(140) + "private marker" + "</div>".repeat(140)), { message: "The HTML document is nested too deeply." });
  await assert.rejects(extract("<h2>Private marker</h2>".repeat(1_001)), /more than 1,000 sections/);
  await assert.rejects(extract("x".repeat(1_000_001)), /1,000,000 character parsing limit/);
  await assert.rejects(extract("<title>This title alone cannot be indexed.</title><script>Hidden content cannot be indexed either.</script>"), /fewer than 20 characters/);
});

test("Markdown splits only real headings outside code and supports Setext titles", async () => {
  const markdown = [
    "    # Indented example", "", "Operations Handbook", "===================", "",
    "This is the first guidance for your team.", "", "```md", "# Example heading", "```", "",
    "## Escalation ##", "", "Contact your manager before raising an alert."
  ].join("\n");
  const result = await new MultiFormatDocumentTextExtractor().extract(textDocument(markdown, "notes.md", "text/plain"));

  assert.equal(result.title, "Operations Handbook");
  assert.deepEqual(result.sections?.map(({ heading }) => heading), [undefined, "Operations Handbook", "Escalation"]);
  assert.match(result.sections?.[0]?.text ?? "", /# Indented example/);
  assert.match(result.sections?.[1]?.text ?? "", /```md\n# Example heading\n```/);
  assert.equal(result.metadata.format, "markdown");
  assert.equal(result.metadata.sectionCount, 3);
});

test("DOCX preserves explicit Word heading styles without requiring a style map from the file", async () => {
  // Minimal OOXML ZIP with Heading1, Heading2 and two normal paragraphs.
  const payload = Buffer.from([
    "UEsDBBQAAAAIAAAAIQD3S4B1wgAAAHYBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QuQ7CMAyGX6XKiqgRAwOiLMAKDLyAlbptRC7FLsfbk3INCBjt//gsLw7XSFxcnPVcqU4kzgFYd+SQyxDJZ6UJyaHkMbUQUR+xJZhOJjPQwQt5GcvQoZaLNTXYWyk2l7xmE3ylEllWxephHFiVwhit0ShZh5OvPyjjJ6HMybuHOxN5lA0KvhIG5TfgmdudKCVTU7HHJFt02QXnkGqog+5dTpb/a77cGZrGaHrnh7aYgiZm41tny7fi0PjX/XB/9/IG",
    "UEsDBBQAAAAIAAAAIQBhey9DiQAAAPIAAAALAAAAX3JlbHMvLnJlbHONzzsOAiEQBuCrEA6ws1pYGKCy2dZ4AQLDIy6PDBj19lJYrMbCcuaffH9GnHHVPZbcQqyNPdKam+Sh93oEaCZg0m0qFfNIXKGk+xjJQ9Xmqj3Cfp4PQFuDK7E12WIlp8XuOLs8K/5jF+eiwVMxt4S5/6j4uhiyJo9d8nshC/a9ngbLQQn4eFG9A",
    "FBLAwQUAAAACAAAACEA5ZicHeQAAAC+AQAAEQAAAHdvcmQvZG9jdW1lbnQueG1shZHBTsMwDIZfxeoDLGMHDlXXC0LaDSR4ATfx2ogkrhyX0rcn7WBcBkiWLcv/b32ym7l2bKdISeEjhpTr+VgNqmNtTLYDRcw7HimV2ZklopZWejOzuFHYUs4+9TGYw35/byL6VLXNXHfslrWOW3qWrbzoEgjm+h3DsToRuuK8q0zbmKtmS9o+jSSonlOGEybXMb+tIt2kcjFc1395XgefoYQOBGcvWaGfvMNkS8sCC08CShh3v2/6C/RwE/QxWwwb6b98D5wUrV5AIibsSaCjwkYg6NczAibAQKK3GM33Vc3Px9pP",
    "UEsBAhQDFAAAAAgAAAAhAPdLgHXCAAAAdgEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACAAAACEAYXsvQ4kAAADyAAAACwAAAAAAAAAAAAAAgAHzAAAAX3JlbHMvLnJlbHNQSwECFAMUAAAACAAAACEA5ZicHeQAAAC+AQAAEQAAAAAAAAAAAAAAgAGlAQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAAuAIAAAAA"
  ].join(""), "base64");
  const result = await new MultiFormatDocumentTextExtractor().extract({ filename: "handbook.docx", mimeType: "application/octet-stream", payload });

  assert.equal(result.title, "Operations Handbook");
  assert.deepEqual(result.sections, [
    { heading: "Operations Handbook", text: "This is the first guidance for your team." },
    { heading: "Escalation", text: "Contact your manager before raising an alert." }
  ]);
  assert.equal(result.metadata.format, "docx");
});

test("language detection distinguishes English, Portuguese, mixed and unknown text", () => {
  const english = "This guide is for the team and should be used when reviewing your policy.";
  const portuguese = "Os documentos são para a equipe. Você deve pedir uma revisão antes do prazo.";
  assert.equal(detectDocumentLanguage(english, "pt-br"), "en");
  assert.equal(detectDocumentLanguage(portuguese), "pt");
  assert.equal(detectDocumentLanguage(`${english}\n\n${portuguese}`), "mixed");
  assert.equal(detectDocumentLanguage("Vertragsunterlagen müssen unterschrieben werden."), "und");
  assert.equal(detectDocumentLanguage("Chronological delivery schedule overview", "en-gb"), "en");
  assert.equal(detectDocumentLanguage("123456789 123456789 123456789", "en-us"), "und");
});

test("the worker persists extracted metadata and chunks without mixing sections or exposing titles in events", async () => {
  type JobEvent = Parameters<IngestionJobRepository["recordEvent"]>[0];
  type PersistedDocument = Parameters<DocumentRepository["replace"]>[0];
  const events: JobEvent[] = [];
  const documents: PersistedDocument[] = [];
  const embedded: string[] = [];
  const html = "<main><h1>Private handbook</h1><p>Use the policy for your team.</p><h2>Escalation</h2><p>Start with the help desk and review the result.</p></main>";
  const job = { ...textDocument(html, "handbook.html", "text/html"), id: "job-1", tenantId: "tenant-1", source: "upload/handbook", title: null };
  const jobs = {
    claimNext: async () => job,
    recordEvent: async (event: JobEvent) => { events.push(event); },
    complete: async () => undefined,
    fail: async (_id: string, reason: string) => assert.fail(reason)
  } as unknown as IngestionJobRepository;
  const repository = {
    replace: async (document: PersistedDocument, chunks: Parameters<DocumentRepository["replace"]>[1]) => {
      documents.push(document);
      assert.deepEqual(chunks.map(({ ordinal }) => ordinal), [0, 1]);
      return { id: "document-1", chunkCount: chunks.length };
    }
  } as DocumentRepository;
  const ingest = new IngestDocumentUseCase({ embed: async (text) => { embedded.push(text); return [1]; } }, repository,
    { chunkSize: 200, chunkOverlap: 20, embeddingConcurrency: 1 });
  const worker = new ProcessNextIngestionJobUseCase(jobs, new MultiFormatDocumentTextExtractor(), ingest, {} as OriginalFileStore);

  assert.equal(await worker.execute(), true);
  assert.deepEqual(embedded, [
    "Private handbook\n\nUse the policy for your team.",
    "Escalation\n\nStart with the help desk and review the result."
  ]);
  assert.equal(documents[0]?.title, "Private handbook");
  assert.deepEqual(documents[0]?.metadata, {
    format: "html", language: "en", sectionCount: 2, requiresOcr: false,
    filename: "handbook.html", mimeType: "text/html", ingestionJobId: "job-1"
  });
  const extraction = events.find(({ stage, status }) => stage === "text_extraction" && status === "completed");
  assert.equal(extraction?.details?.sectionCount, 2);
  assert.doesNotMatch(JSON.stringify(events), /Private handbook|Start with the help desk/);
});
