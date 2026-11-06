import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import type { DocumentTextExtractor } from "../../application/ports/document-text-extractor.js";

const textTypes = new Set(["text/plain", "text/markdown", "text/html", "application/octet-stream"]);

export class MultiFormatDocumentTextExtractor implements DocumentTextExtractor {
  async extract(input: { filename: string; mimeType: string; payload: Buffer }): Promise<{ text: string; metadata: Record<string, string | boolean> }> {
    const extension = input.filename.toLowerCase().split(".").pop();
    let text: string;
    let format: "pdf" | "docx" | "html" | "markdown" | "text";
    if (extension === "pdf" || input.mimeType === "application/pdf") {
      const parser = new PDFParse({ data: input.payload });
      try { text = (await parser.getText()).text; } finally { await parser.destroy(); }
      format = "pdf";
    }
    else if (extension === "docx" || input.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") { text = (await mammoth.extractRawText({ buffer: input.payload })).value; format = "docx"; }
    else if (extension === "html" || extension === "htm" || input.mimeType === "text/html") { text = htmlToText(input.payload.toString("utf8")); format = "html"; }
    else if (extension === "md" || extension === "markdown" || input.mimeType === "text/markdown") { text = input.payload.toString("utf8"); format = "markdown"; }
    else if (extension === "txt" || textTypes.has(input.mimeType)) { text = input.payload.toString("utf8"); format = "text"; }
    else throw new Error("Unsupported file type. Use PDF, DOCX, HTML, TXT or Markdown.");
    const normalized = text.replace(/\u0000/g, "").trim();
    if (normalized.length < 20) {
      if (format === "pdf") throw new Error("The PDF has no extractable text and likely needs OCR.");
      throw new Error("The extracted document has fewer than 20 characters.");
    }
    return { text: normalized, metadata: { format, language: detectLanguage(normalized), requiresOcr: false } };
  }
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
