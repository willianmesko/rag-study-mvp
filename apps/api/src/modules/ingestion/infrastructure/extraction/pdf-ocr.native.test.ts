import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import type { DocumentExtractionEvent } from "../../application/ports/document-text-extractor.js";
import { MultiFormatDocumentTextExtractor } from "./document-text-extractor.js";
import { PopplerTesseractOcr } from "./pdf-ocr.js";
import { makePdf, makeScannedPdf } from "./pdf-test-fixture.js";

const languages = process.env.PDF_OCR_SMOKE_LANGUAGES;

test("native OCR extracts a scanned page in order between native PDF text pages", { skip: !languages, timeout: 60_000 }, async () => {
  const installed = execFileSync("tesseract", ["--list-langs"], { encoding: "utf8", timeout: 5_000 }).split(/\r?\n/);
  for (const language of languages!.split("+")) {
    assert.ok(installed.includes(language), `Tesseract language data is missing for ${language}.`);
  }

  const nativeBefore = "Native text before the scan.";
  const nativeAfter = "Native text after the scan.";
  const events: DocumentExtractionEvent[] = [];
  const extractor = new MultiFormatDocumentTextExtractor({
    ocr: new PopplerTesseractOcr({ languages: languages!, timeoutMs: 45_000 }),
    maxOcrPages: 8
  });
  const result = await extractor.extract({
    filename: "synthetic-ocr.pdf",
    mimeType: "application/pdf",
    payload: makePdf([nativeBefore, null, nativeAfter])
  }, async (event) => { events.push(event); });

  assert.match(result.text, /^Native text before the scan\.[\s\S]*Scanned invoice for the OCR demo\.[\s\S]*Native text after the scan\.$/i);
  assert.equal(result.metadata.ocrUsed, true);
  assert.equal(result.metadata.ocrPages, 1);
  assert.deepEqual(events.map(({ status }) => status), ["started", "completed"]);
  const completed = events[1];
  assert.equal(completed?.status, "completed");
  if (completed?.status === "completed") {
    assert.equal(completed.details.totalPages, 3);
    assert.equal(completed.details.emptyPages, 0);
    assert.ok(completed.details.wordCount >= 6);
  }
});

test("native OCR extracts Portuguese text from a scanned PDF", { skip: !languages?.split("+").includes("por"), timeout: 60_000 }, async () => {
  const extractor = new MultiFormatDocumentTextExtractor({
    ocr: new PopplerTesseractOcr({ languages: languages!, timeoutMs: 45_000 }),
    maxOcrPages: 8
  });
  const result = await extractor.extract({
    filename: "synthetic-ocr-pt.pdf",
    mimeType: "application/pdf",
    payload: makeScannedPdf("pt")
  });

  // OCR engines and language-data versions can disagree about diacritics.
  const recognized = result.text.normalize("NFD").replace(/\p{M}/gu, "");
  assert.match(recognized, /Nota fiscal para revisao da equipe/i);
  assert.equal(result.metadata.language, "pt");
  assert.equal(result.metadata.ocrPages, 1);
});
