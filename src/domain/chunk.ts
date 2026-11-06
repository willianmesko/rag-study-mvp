import type { TextChunk } from "./document.js";

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function splitLongText(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const boundary = Math.max(rest.lastIndexOf(" ", maxChars), rest.lastIndexOf("\n", maxChars));
    const end = boundary > maxChars / 2 ? boundary : maxChars;
    pieces.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

function sentences(paragraph: string, maxChars: number): string[] {
  const candidates = paragraph.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [paragraph];
  return candidates.flatMap((sentence) => splitLongText(sentence.trim(), maxChars));
}

function trailingOverlap(text: string, overlapChars: number): string {
  if (overlapChars === 0) return "";
  const tail = text.slice(-overlapChars);
  const firstSpace = tail.indexOf(" ");
  return (firstSpace >= 0 ? tail.slice(firstSpace + 1) : "").trim();
}

export function chunkText(text: string, maxChars: number, overlapChars: number): TextChunk[] {
  if (maxChars <= 0 || overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error("Require maxChars > 0 and 0 <= overlapChars < maxChars.");
  }

  const parts = normalize(text)
    .split(/\n\n+/)
    .flatMap((paragraph) => sentences(paragraph, maxChars));
  const chunks: string[] = [];
  let current = "";

  for (const part of parts) {
    const candidate = current ? `${current} ${part}` : part;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = trailingOverlap(current, overlapChars);
    }
    if (current && `${current} ${part}`.length > maxChars) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current} ${part}` : part;
  }

  if (current) chunks.push(current);
  return chunks.map((content, ordinal) => ({ ordinal, content }));
}

