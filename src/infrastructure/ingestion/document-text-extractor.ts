import mammoth from "mammoth";
import pdf from "pdf-parse";
import type { DocumentTextExtractor } from "../../application/ports/document-text-extractor.js";

const textTypes = new Set(["text/plain", "text/markdown", "application/octet-stream"]);

export class MultiFormatDocumentTextExtractor implements DocumentTextExtractor {
  async extract(input: { filename: string; mimeType: string; payload: Buffer }): Promise<string> {
    const extension = input.filename.toLowerCase().split(".").pop();
    let text: string;
    if (extension === "pdf" || input.mimeType === "application/pdf") text = (await pdf(input.payload)).text;
    else if (extension === "docx" || input.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") text = (await mammoth.extractRawText({ buffer: input.payload })).value;
    else if (extension === "txt" || extension === "md" || extension === "markdown" || textTypes.has(input.mimeType)) text = input.payload.toString("utf8");
    else throw new Error("Unsupported file type. Use PDF, DOCX, TXT or Markdown.");
    const normalized = text.replace(/\u0000/g, "").trim();
    if (normalized.length < 20) throw new Error("The extracted document has fewer than 20 characters.");
    return normalized;
  }
}
