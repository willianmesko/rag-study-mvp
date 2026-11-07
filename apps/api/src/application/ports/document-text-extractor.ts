import type { DocumentSection } from "../../domain/chunk.js";

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
