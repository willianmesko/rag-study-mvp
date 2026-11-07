import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import type {
  DocumentExtractionEvent, DocumentTextExtractor, ExtractedDocument, ExtractionStageReporter, NativeDocumentExtraction
} from "../../application/ports/document-text-extractor.js";
import { detectDocumentLanguage } from "./document-language.js";
import { extractMarkdownSections, sectionText, validateSectionCount } from "./document-sections.js";
import { extractHtml } from "./extract-html.js";
import { PdfOcrError, type PdfOcrEngine } from "./pdf-ocr.js";

const textTypes = new Set(["text/plain", "application/octet-stream"]);
const MIN_TEXT_LENGTH = 20;
const MAX_TEXT_LENGTH = 500_000;
const pageNumberOnly = /^(?:(?:page|p[aá]gina)\s+)?[-–—\s]*\d+(?:\s*(?:of|de|\/)\s*\d+)?[-–—\s]*$/iu;

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

  async extractNative(input:{filename:string;mimeType:string;payload:Buffer},signal?:AbortSignal):Promise<NativeDocumentExtraction> {
    signal?.throwIfAborted();
    if(input.filename.toLowerCase().endsWith('.pdf')||input.mimeType.split(';')[0]?.trim()==='application/pdf') {
      const nativePages=await readNativePages(input.payload,signal);
      validateSectionCount(nativePages.length);
      const text=joinPages(nativePages);
      if(text.length>MAX_TEXT_LENGTH)validateTextLength(text);
      return{text,nativePages,metadata:{format:'pdf'}};
    }
    const result=await this.extract(input,undefined,signal);signal?.throwIfAborted();return result;
  }
  completeNative(native:NativeDocumentExtraction,input:{payload:Buffer},report?:ExtractionStageReporter,signal?:AbortSignal):Promise<ExtractedDocument> {
    return native.nativePages?this.extractPdf(input.payload,report,native.nativePages,signal):Promise.resolve(native);
  }
  async extract(input: { filename: string; mimeType: string; payload: Buffer }, report?: ExtractionStageReporter,signal?:AbortSignal): Promise<ExtractedDocument> {
    signal?.throwIfAborted();
    const extension = input.filename.toLowerCase().split(".").pop();
    const mimeType = input.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (extension === "pdf" || mimeType === "application/pdf") {
      return this.extractPdf(input.payload, report,undefined,signal);
    }
    if (extension === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      return extractDocx(input.payload);
    }
    if (extension === "html" || extension === "htm" || mimeType === "text/html") {
      const { sections, ...metadata } = extractHtml(input.payload.toString("utf8"));
      return textResult("html", sectionText(sections), { sections, ...metadata });
    }
    if (extension === "md" || extension === "markdown" || mimeType === "text/markdown") {
      const text = input.payload.toString("utf8").replace(/[\u0000\uFEFF]/g, "");
      validateTextLength(text.trim());
      const structure = extractMarkdownSections(text);
      return structure.sections.some(({ heading }) => heading)
        ? textResult("markdown", sectionText(structure.sections), structure)
        : textResult("markdown", text.trim());
    }
    if (extension === "txt" || textTypes.has(mimeType)) return textResult("text", normalize(input.payload.toString("utf8")));
    throw new Error("Unsupported file type. Use PDF, DOCX, HTML, TXT or Markdown.");
  }

  private async extractPdf(payload: Buffer, report?: ExtractionStageReporter,nativePages?:string[],signal?:AbortSignal): Promise<ExtractedDocument> {
    signal?.throwIfAborted();
    const pages = nativePages??await readNativePages(payload,signal);
    validateSectionCount(pages.length);
    const nativeText = joinPages(pages);
    if (nativeText.length > MAX_TEXT_LENGTH) validateTextLength(nativeText);

    const pageNumbers = pages.flatMap((text, index) => hasReadableContent(text) ? [] : [index + 1]);
    if (pageNumbers.length === 0) {
      validateTextLength(nativeText);
      return pdfResult(pages, pages.length);
    }

    const pageCounts = { totalPages: pages.length, requestedPages: pageNumbers.length };
    if (!this.options.ocr) {
      // A blank separator is indistinguishable from a scan at this stage. Keep
      // usable native text in OCR-disabled environments and mark omitted pages.
      const readablePages = pages.filter(hasReadableContent);
      if (joinPages(readablePages).length >= MIN_TEXT_LENGTH) {
        await report?.({ stage: "ocr", status: "info", details: { code: "ocr_disabled", ...pageCounts } });
        return pdfResult(readablePages, pages.length, { requiresOcr: true });
      }
    }

    const startedAt = Date.now();
    await report?.({ stage: "ocr", status: "started", details: pageCounts });
    let indexedPages: string[];
    let summary: OcrSummary;
    try {
      if (!this.options.ocr) throw new ExtractionOcrError("ocr_disabled");
      if (pageNumbers.length > this.options.maxOcrPages) throw new ExtractionOcrError("ocr_page_limit");

      const recognized = await this.options.ocr.recognize({ pdf: payload, pageNumbers },signal);
      signal?.throwIfAborted();
      const byPage = indexOcrPages(pageNumbers, recognized.pages);
      // Empty OCR output cannot turn a page number or a blank scan into indexable text.
      indexedPages = pages.map((native, index) => byPage.get(index + 1)?.text ?? native);
      const text = joinPages(indexedPages);
      if (text.length < MIN_TEXT_LENGTH) throw new ExtractionOcrError("ocr_no_text");
      if (text.length > MAX_TEXT_LENGTH) throw new ExtractionOcrError("ocr_output_limit");
      summary = summarizeOcr(pages.length, byPage);
    } catch (error) {
      signal?.throwIfAborted();
      const code = error instanceof ExtractionOcrError || error instanceof PdfOcrError
        ? error.code
        : "ocr_recognition_failed";
      await report?.({ stage: "ocr", status: "failed", durationMs: Date.now() - startedAt, details: { code } });
      throw new ExtractionOcrError(code);
    }

    await report?.({ stage: "ocr", status: "completed", durationMs: Date.now() - startedAt, details: summary });
    return pdfResult(indexedPages, pages.length, { ocr: summary, requiresOcr: true });
  }
}

async function readNativePages(payload: Buffer,signal?:AbortSignal): Promise<string[]> {
  try {
    const parser = new PDFParse({ data: payload, isEvalSupported: false });
    const abort=()=>{void parser.destroy().catch(()=>undefined);};
    signal?.addEventListener('abort',abort,{once:true});
    try {
      const result = await parser.getText();
      signal?.throwIfAborted();
      if (result.total < 1 || result.pages.length !== result.total ||
        !result.pages.every((page, index) => page.num === index + 1)) {
        throw new Error("Incomplete PDF page list.");
      }
      return result.pages.map(({ text }) => normalize(text));
    } finally {
      signal?.removeEventListener('abort',abort);
      await parser.destroy();
    }
  } catch {
    signal?.throwIfAborted();
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

export function hasReadableContent(text: string): boolean {
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
  pages: string[],
  totalPages: number,
  { ocr, requiresOcr = false }: { ocr?: OcrSummary; requiresOcr?: boolean } = {}
): ExtractedDocument {
  const text = joinPages(pages);
  const sections = pages.filter(Boolean).map((page) => ({ text: page }));
  return {
    text,
    sections,
    metadata: {
      format: "pdf",
      language: detectDocumentLanguage(text),
      sectionCount: sections.length,
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

function textResult(
  format: "docx" | "html" | "markdown" | "text",
  text: string,
  { title, sections, description, languageHint }: Pick<ExtractedDocument, "title" | "sections"> & { description?: string; languageHint?: string } = {}
): ExtractedDocument {
  validateTextLength(text);
  return {
    text,
    ...(title && { title }),
    ...(sections && { sections }),
    metadata: {
      format,
      language: detectDocumentLanguage(text, languageHint),
      sectionCount: sections?.length ?? 1,
      requiresOcr: false,
      ...(description && { description }),
      ...(languageHint && { languageHint })
    }
  };
}

async function extractDocx(payload: Buffer): Promise<ExtractedDocument> {
  let html: string;
  try {
    ({ value: html } = await mammoth.convertToHtml({ buffer: payload }, {
      externalFileAccess: false,
      includeEmbeddedStyleMap: false,
      convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
      styleMap: ["p.Title => h1:fresh", "p[style-name='Title'] => h1:fresh"]
    }));
  } catch {
    return extractRawDocx(payload);
  }
  const { sections, title } = extractHtml(html);
  return sections.length > 0 ? textResult("docx", sectionText(sections), { sections, title }) : extractRawDocx(payload);
}

async function extractRawDocx(payload: Buffer): Promise<ExtractedDocument> {
  let text: string;
  try {
    ({ value: text } = await mammoth.extractRawText({ buffer: payload }));
  } catch {
    throw new Error("The DOCX could not be read. Check that the file is valid and unlocked.");
  }
  return textResult("docx", normalize(text));
}
