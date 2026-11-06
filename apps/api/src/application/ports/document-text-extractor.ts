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

export interface DocumentTextExtractor {
  extract(input: { filename: string; mimeType: string; payload: Buffer }, report?: ExtractionStageReporter): Promise<{
    text: string;
    metadata: Record<string, string | boolean | number>;
  }>;
}
