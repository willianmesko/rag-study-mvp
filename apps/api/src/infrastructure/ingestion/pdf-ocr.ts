import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

export type PdfOcrPage = {
  pageNumber: number;
  text: string;
  wordCount: number;
  meanConfidence: number | null;
};

export interface PdfOcrEngine {
  recognize(input: { pdf: Buffer; pageNumbers: readonly number[] }): Promise<{ pages: PdfOcrPage[] }>;
}

const errorMessages = {
  ocr_unavailable: "The OCR tools are unavailable.",
  ocr_timeout: "OCR exceeded the processing time limit.",
  ocr_render_failed: "OCR could not render a PDF page.",
  ocr_recognition_failed: "OCR could not recognize a PDF page.",
  ocr_output_limit: "OCR exceeded the processing output limit."
} as const;

export type PdfOcrErrorCode = keyof typeof errorMessages;

export class PdfOcrError extends Error {
  constructor(public readonly code: PdfOcrErrorCode) {
    super(errorMessages[code]);
    this.name = "PdfOcrError";
  }
}

const maxPagePixels = 2_000;
const maxPngBytes = 5 * 1024 * 1024;
const maxTsvBytes = 2 * 1024 * 1024;
const maxRecognizedCharacters = 500_000;
const tsvHeader = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";

export class PopplerTesseractOcr implements PdfOcrEngine {
  constructor(private readonly options: { languages: string; timeoutMs: number }) {
    if (!/^[a-z]{3}(?:\+[a-z]{3}){0,3}$/.test(options.languages)) {
      throw new Error("OCR languages must be three-letter Tesseract codes separated by plus signs.");
    }
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 2_147_483_647) {
      throw new Error("OCR timeout must be a positive timer duration in milliseconds.");
    }
  }

  async recognize({ pdf, pageNumbers }: { pdf: Buffer; pageNumbers: readonly number[] }): Promise<{ pages: PdfOcrPage[] }> {
    const deadline = performance.now() + this.options.timeoutMs;
    const pages: PdfOcrPage[] = [];
    let recognizedCharacters = 0;

    for (const pageNumber of pageNumbers) {
      if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) throw new PdfOcrError("ocr_render_failed");
      const page = String(pageNumber);
      const png = await runOcrCommand(
        "pdftoppm", ["-f", page, "-l", page, "-scale-to", String(maxPagePixels), "-gray", "-singlefile", "-png", "-"],
        pdf, maxPngBytes, deadline, "ocr_render_failed"
      );
      const tsv = await runOcrCommand(
        "tesseract", ["stdin", "stdout", "-l", this.options.languages, "--psm", "3", "-c", "tessedit_create_tsv=1"],
        png, maxTsvBytes, deadline, "ocr_recognition_failed"
      );
      const result = parseTesseractTsv(tsv.toString("utf8"));
      if (performance.now() >= deadline) throw new PdfOcrError("ocr_timeout");
      recognizedCharacters += result.text.length;
      if (recognizedCharacters > maxRecognizedCharacters) throw new PdfOcrError("ocr_output_limit");
      pages.push({ pageNumber, ...result });
    }

    return { pages };
  }
}

export function parseTesseractTsv(tsv: string): Omit<PdfOcrPage, "pageNumber"> {
  const [header, ...rows] = tsv.split(/\r?\n/);
  if (header !== tsvHeader) throw new PdfOcrError("ocr_recognition_failed");

  const textParts: string[] = [];
  let previousParagraph = "";
  let previousLine = "";
  let wordCount = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (const row of rows) {
    if (!row.startsWith("5\t")) continue;
    const columns = row.split("\t");
    const word = columns.slice(11).join("\t").trim();
    if (!word) continue;

    const paragraph = columns.slice(1, 4).join(":");
    const line = columns[4];
    if (wordCount > 0) {
      const separator = paragraph !== previousParagraph ? "\n\n" : line !== previousLine ? "\n" : " ";
      textParts.push(separator);
    }
    textParts.push(word);
    previousParagraph = paragraph;
    previousLine = line;
    wordCount++;

    const confidence = columns[10]?.trim();
    const score = confidence ? Number(confidence) : NaN;
    if (Number.isFinite(score) && score >= 0 && score <= 100) {
      confidenceSum += score;
      confidenceCount++;
    }
  }

  return {
    text: textParts.join(""),
    wordCount,
    meanConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : null
  };
}

function runOcrCommand(
  command: "pdftoppm" | "tesseract",
  args: string[],
  input: Buffer,
  maxBytes: number,
  deadline: number,
  commandFailure: "ocr_render_failed" | "ocr_recognition_failed"
): Promise<Buffer> {
  const remainingMs = Math.ceil(deadline - performance.now());
  if (remainingMs <= 0) return Promise.reject(new PdfOcrError("ocr_timeout"));

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "ignore"],
      shell: false,
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        LANG: "C",
        OMP_THREAD_LIMIT: "1",
        TESSDATA_PREFIX: process.env.TESSDATA_PREFIX
      }
    });
    const output: Buffer[] = [];
    let bytes = 0;
    let failure: PdfOcrError | undefined;
    const timer = setTimeout(() => stop("ocr_timeout"), remainingMs);

    function stop(code: PdfOcrErrorCode) {
      if (failure) return;
      failure = new PdfOcrError(code);
      child.kill("SIGKILL");
      child.stdin.destroy();
      child.stdout.destroy();
    }

    child.once("error", (error: NodeJS.ErrnoException) => {
      failure ??= new PdfOcrError(error.code === "ENOENT" || error.code === "EACCES" ? "ocr_unavailable" : commandFailure);
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") stop(commandFailure);
    });
    child.stdout.on("error", () => stop(commandFailure));
    child.stdout.on("data", (chunk: Buffer) => {
      if (failure) return;
      if (bytes + chunk.length > maxBytes) {
        stop("ocr_output_limit");
        return;
      }
      bytes += chunk.length;
      output.push(chunk);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (performance.now() >= deadline) reject(new PdfOcrError("ocr_timeout"));
      else if (code !== 0 || bytes === 0) reject(new PdfOcrError(commandFailure));
      else resolve(Buffer.concat(output, bytes));
    });

    child.stdin.end(input);
  });
}
