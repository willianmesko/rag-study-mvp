import type { DocumentSection } from "../../../knowledge/index.js";

const extractionErrorMessages = {
  ocr_disabled: "This PDF contains scanned pages. Enable OCR and try again.",
  ocr_page_limit: "This PDF exceeds the scanned page limit. Split it into smaller files and try again.",
  ocr_no_text: "OCR found no usable text in this PDF. Try a clearer scan.",
  ocr_unavailable: "The PDF OCR tools or requested languages are unavailable.",
  ocr_timeout: "OCR exceeded its time limit. Split the PDF into smaller files and try again.",
  ocr_render_failed: "A PDF page could not be rendered for OCR. Check that the file is valid and unlocked.",
  ocr_recognition_failed: "A PDF page could not be read by OCR. Try a clearer scan.",
  ocr_output_limit: "This PDF exceeds the extracted text limit. Split it into smaller files and try again."
} as const;

export class DocumentExtractionError extends Error {
  constructor(readonly code: keyof typeof extractionErrorMessages) {
    super(extractionErrorMessages[code]);
    this.name = "DocumentExtractionError";
  }
}

export function publicExtractionFailure(error: unknown): string | undefined {
  return error instanceof DocumentExtractionError ? extractionErrorMessages[error.code] : undefined;
}

export type DocumentExtractionEvent =
  | { stage: "ocr"; status: "started"; details: { totalPages: number; requestedPages: number } }
  | { stage: "ocr"; status: "info"; details: { code: "ocr_disabled"; totalPages: number; requestedPages: number } }
  | { stage: "ocr"; status: "completed"; durationMs: number; details: {
      totalPages: number;
      ocrPages: number;
      wordCount: number;
      meanConfidence: number | null;
      emptyPages: number;
    } }
  | { stage: "ocr"; status: "failed"; durationMs: number; details: { code: string } };

export type ExtractionStageReporter = (event: DocumentExtractionEvent) => Promise<void>;

export type ExtractedDocument = {
  text: string;
  title?: string;
  sections?: readonly DocumentSection[];
  metadata: Record<string, string | boolean | number>;
};
export type NativeDocumentExtraction = ExtractedDocument & { nativePages?:string[] };

export interface DocumentTextExtractor {
  extract(input: { filename: string; mimeType: string; payload: Buffer }, report?: ExtractionStageReporter,signal?:AbortSignal): Promise<ExtractedDocument>;
  extractNative?(input: {filename:string;mimeType:string;payload:Buffer},signal?:AbortSignal):Promise<NativeDocumentExtraction>;
  completeNative?(native:NativeDocumentExtraction,input:{payload:Buffer},report?:ExtractionStageReporter,signal?:AbortSignal):Promise<ExtractedDocument>;
}
