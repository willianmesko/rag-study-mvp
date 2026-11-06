import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import type {
  DocumentExtractionEvent, DocumentTextExtractor, ExtractionStageReporter
} from "../../application/ports/document-text-extractor.js";
import { PdfOcrError, type PdfOcrEngine } from "./pdf-ocr.js";

const textTypes = new Set(["text/plain", "text/markdown", "text/html", "application/octet-stream"]);
const MIN_TEXT_LENGTH = 20;
const MAX_TEXT_LENGTH = 500_000;
const pageNumberOnly = /^(?:(?:page|p[aá]gina)\s+)?[-–—\s]*\d+(?:\s*(?:of|de|\/)\s*\d+)?[-–—\s]*$/iu;

type Extracted = Awaited<ReturnType<DocumentTextExtractor["extract"]>>;
type OcrSummary = Extract<DocumentExtractionEvent, { status: "completed" }>["details"];
type OcrPage = Awaited<ReturnType<PdfOcrEngine["recognize"]>>["pages"][number];
type OcrFailureCode = PdfOcrError["code"] | "ocr_disabled" | "ocr_page_limit" | "ocr_no_text";

const ocrErrorMessages: Record<OcrFailureCode, string> = {
  ocr_disabled: "This PDF contains scanned pages. Enable OCR and try again.",
  ocr_page_limit: "This PDF exceeds the scanned page limit. Split it into smaller files and try again.",
  ocr_no_text: "OCR found no usable text in this PDF. Try a clearer scan.",
  ocr_unavailable: "The PDF OCR tools or requested languages are unavailable.",
  ocr_timeout: "OCR exceeded its time limit. Split the PDF into smaller files and try again.",
  ocr_render_failed: "A PDF page could not be rendered for OCR. Check that the file is valid and unlocked.",
  ocr_recognition_failed: "A PDF page could not be read by OCR. Try a clearer scan.",
  ocr_output_limit: "This PDF exceeds the extracted text limit. Split it into smaller files and try again."
};

class ExtractionOcrError extends Error {
  constructor(readonly code: OcrFailureCode) {
    super(ocrErrorMessages[code]);
  }
}

export class MultiFormatDocumentTextExtractor implements DocumentTextExtractor {
  constructor(private readonly options: { ocr?: PdfOcrEngine; maxOcrPages: number } = { maxOcrPages: 8 }) {}

  async extract(input: { filename: string; mimeType: string; payload: Buffer }, report?: ExtractionStageReporter): Promise<Extracted> {
    const extension = input.filename.toLowerCase().split(".").pop();
    if (extension === "pdf" || input.mimeType === "application/pdf") {
      return this.extractPdf(input.payload, report);
    }

    let text: string;
    let format: "docx" | "html" | "markdown" | "text";
    if (extension === "docx" || input.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") { text = (await mammoth.extractRawText({ buffer: input.payload })).value; format = "docx"; }
    else if (extension === "html" || extension === "htm" || input.mimeType === "text/html") { text = htmlToText(input.payload.toString("utf8")); format = "html"; }
    else if (extension === "md" || extension === "markdown" || input.mimeType === "text/markdown") { text = input.payload.toString("utf8"); format = "markdown"; }
    else if (extension === "txt" || textTypes.has(input.mimeType)) { text = input.payload.toString("utf8"); format = "text"; }
    else throw new Error("Unsupported file type. Use PDF, DOCX, HTML, TXT or Markdown.");
    const normalized = normalize(text);
    validateTextLength(normalized);
    return { text: normalized, metadata: { format, language: detectLanguage(normalized), requiresOcr: false } };
  }

  private async extractPdf(payload: Buffer, report?: ExtractionStageReporter): Promise<Extracted> {
    const pages = await readNativePages(payload);
    const nativeText = joinPages(pages);
    if (nativeText.length > MAX_TEXT_LENGTH) validateTextLength(nativeText);

    const pageNumbers = pages.flatMap((text, index) => hasReadableContent(text) ? [] : [index + 1]);
    if (pageNumbers.length === 0) {
      validateTextLength(nativeText);
      return pdfResult(nativeText, pages.length);
    }

    const pageCounts = { totalPages: pages.length, requestedPages: pageNumbers.length };
    if (!this.options.ocr) {
      // A blank separator is indistinguishable from a scan at this stage. Keep
      // usable native text in OCR-disabled environments and mark omitted pages.
      const readableText = joinPages(pages.filter(hasReadableContent));
      if (readableText.length >= MIN_TEXT_LENGTH) {
        await report?.({ stage: "ocr", status: "info", details: { code: "ocr_disabled", ...pageCounts } });
        return pdfResult(readableText, pages.length, { requiresOcr: true });
      }
    }

    const startedAt = Date.now();
    await report?.({ stage: "ocr", status: "started", details: pageCounts });
    let text: string;
    let summary: OcrSummary;
    try {
      if (!this.options.ocr) throw new ExtractionOcrError("ocr_disabled");
      if (pageNumbers.length > this.options.maxOcrPages) throw new ExtractionOcrError("ocr_page_limit");

      const recognized = await this.options.ocr.recognize({ pdf: payload, pageNumbers });
      const byPage = indexOcrPages(pageNumbers, recognized.pages);
      // Empty OCR output cannot turn a page number or a blank scan into indexable text.
      text = joinPages(pages.map((native, index) => byPage.get(index + 1)?.text ?? native));
      if (text.length < MIN_TEXT_LENGTH) throw new ExtractionOcrError("ocr_no_text");
      if (text.length > MAX_TEXT_LENGTH) throw new ExtractionOcrError("ocr_output_limit");
      summary = summarizeOcr(pages.length, byPage);
    } catch (error) {
      const code = error instanceof ExtractionOcrError || error instanceof PdfOcrError
        ? error.code
        : "ocr_recognition_failed";
      await report?.({ stage: "ocr", status: "failed", durationMs: Date.now() - startedAt, details: { code } });
      throw new ExtractionOcrError(code);
    }

    await report?.({ stage: "ocr", status: "completed", durationMs: Date.now() - startedAt, details: summary });
    return pdfResult(text, pages.length, { ocr: summary, requiresOcr: true });
  }
}

async function readNativePages(payload: Buffer): Promise<string[]> {
  try {
    const parser = new PDFParse({ data: payload, isEvalSupported: false });
    try {
      const result = await parser.getText();
      if (result.total < 1 || result.pages.length !== result.total ||
        !result.pages.every((page, index) => page.num === index + 1)) {
        throw new Error("Incomplete PDF page list.");
      }
      return result.pages.map(({ text }) => normalize(text));
    } finally {
      await parser.destroy();
    }
  } catch {
    throw new Error("The PDF could not be read. Check that the file is valid and unlocked.");
  }
}

function normalize(text: string): string {
  return text.replace(/\u0000/g, "").trim();
}

function validateTextLength(text: string): void {
  if (text.length < MIN_TEXT_LENGTH) throw new Error("The extracted document has fewer than 20 characters.");
  if (text.length > MAX_TEXT_LENGTH) throw new Error("The extracted document exceeds the 500,000 character limit.");
}

function hasReadableContent(text: string): boolean {
  return text.split(/\r?\n/).some((line) => /[\p{L}\p{N}]/u.test(line) && !pageNumberOnly.test(line.trim()));
}

function joinPages(pages: string[]): string {
  return pages.filter(Boolean).join("\n\n");
}

function indexOcrPages(requested: number[], pages: OcrPage[]): Map<number, OcrPage> {
  const byPage = new Map<number, OcrPage>();
  const expected = new Set(requested);
  for (const page of pages) {
    if (!expected.delete(page.pageNumber)) throw new ExtractionOcrError("ocr_recognition_failed");
    const text = normalize(page.text);
    byPage.set(page.pageNumber, hasReadableContent(text)
      ? { ...page, text }
      : { pageNumber: page.pageNumber, text: "", wordCount: 0, meanConfidence: null });
  }
  if (expected.size > 0) throw new ExtractionOcrError("ocr_recognition_failed");
  return byPage;
}

function summarizeOcr(totalPages: number, pages: Map<number, OcrPage>): OcrSummary {
  let wordCount = 0;
  let emptyPages = 0;
  let confidenceWords = 0;
  let confidenceSum = 0;
  for (const page of pages.values()) {
    wordCount += page.wordCount;
    if (!page.text) emptyPages++;
    if (page.meanConfidence !== null) {
      confidenceWords += page.wordCount;
      confidenceSum += page.meanConfidence * page.wordCount;
    }
  }
  const meanConfidence = confidenceWords > 0 ? Math.round((confidenceSum / confidenceWords) * 10) / 10 : null;
  return { totalPages, ocrPages: pages.size, wordCount, meanConfidence, emptyPages };
}

function pdfResult(
  text: string,
  totalPages: number,
  { ocr, requiresOcr = false }: { ocr?: OcrSummary; requiresOcr?: boolean } = {}
): Extracted {
  return {
    text,
    metadata: {
      format: "pdf",
      language: detectLanguage(text),
      requiresOcr,
      ocrUsed: Boolean(ocr),
      pageCount: totalPages,
      ...(ocr && {
        ocrPages: ocr.ocrPages,
        ocrWordCount: ocr.wordCount,
        ocrEmptyPages: ocr.emptyPages,
        ...(ocr.meanConfidence !== null && { ocrMeanConfidence: ocr.meanConfidence })
      })
    }
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, "\"");
}

function detectLanguage(text: string): string {
  const words = text.toLowerCase().match(/[a-zà-ÿ]+/g) ?? [];
  const portuguese = new Set(["a", "o", "de", "da", "do", "para", "com", "não", "uma", "que", "em", "por"]);
  const english = new Set(["the", "and", "of", "to", "in", "for", "with", "is", "that", "from"]);
  const score = (dictionary: Set<string>) => words.reduce((total, word) => total + Number(dictionary.has(word)), 0);
  const pt = score(portuguese);
  const en = score(english);
  return pt === en ? "und" : pt > en ? "pt" : "en";
}
