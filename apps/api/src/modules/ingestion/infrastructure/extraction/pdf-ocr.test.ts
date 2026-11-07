import assert from "node:assert/strict";
import test from "node:test";
import { parseTesseractTsv, PdfOcrError } from "./pdf-ocr.js";

const header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";

test("Tesseract output retains line and paragraph boundaries and averages word confidence", () => {
  const tsv = [
    header,
    "1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t",
    "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t80\tPolítica",
    "5\t1\t1\t1\t1\t2\t20\t0\t10\t10\t100\tinterna",
    "5\t1\t1\t1\t2\t1\t0\t10\t10\t10\t-1\tAprovada",
    "5\t1\t1\t2\t1\t1\t0\t30\t10\t10\t90\tRevisão"
  ].join("\r\n");
  assert.deepEqual(parseTesseractTsv(tsv), {
    text: "Política interna\nAprovada\n\nRevisão",
    wordCount: 4,
    meanConfidence: 90
  });
});

test("blank OCR pages produce no text and no confidence measurement", () => {
  const tsv = `${header}\n1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t\n`;
  assert.deepEqual(parseTesseractTsv(tsv), { text: "", wordCount: 0, meanConfidence: null });
});

test("malformed OCR output fails without exposing its content", () => {
  assert.throws(
    () => parseTesseractTsv("internal OCR data"),
    (error: unknown) => error instanceof PdfOcrError
      && error.code === "ocr_recognition_failed"
      && !error.message.includes("internal OCR data")
  );
});
