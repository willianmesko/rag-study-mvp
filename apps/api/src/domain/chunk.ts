import type { TextChunk } from "./document.js";

export type DocumentSection = { heading?: string; text: string };

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

function sentences(paragraph: string, maxChars: number, preserveParagraphs: boolean): string[] {
  const candidates = preserveParagraphs
    ? paragraph.split(/(?<=[.!?])\s+/u)
    : paragraph.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [paragraph];
  return candidates.flatMap((sentence) => splitLongText(sentence.trim(), maxChars));
}

function trailingOverlap(text: string, overlapChars: number): string {
  if (overlapChars === 0) return "";
  const tail = text.slice(-overlapChars);
  const firstSpace = tail.indexOf(" ");
  return (firstSpace >= 0 ? tail.slice(firstSpace + 1) : "").trim();
}

export function chunkText(text: string, maxChars: number, overlapChars: number): TextChunk[] {
  return chunkContent(text, maxChars, overlapChars, false).map((content, ordinal) => ({ ordinal, content }));
}

export function chunkSections(sections: readonly DocumentSection[], maxChars: number, overlapChars: number): TextChunk[] {
  validateChunkBudget(maxChars, overlapChars);
  const chunks = sections.flatMap(({ heading, text }) => {
    const label = heading && normalize(heading).slice(0, Math.min(160, Math.floor(maxChars / 3))).trimEnd();
    const prefix = label && maxChars >= 6 ? `${label}\n\n` : "";
    const bodyBudget = maxChars - prefix.length;
    const content = chunkContent(text, bodyBudget, Math.min(overlapChars, bodyBudget - 1), true);
    if (content.length === 0) return label ? [label] : [];
    return content.map((body) => prefix + body);
  });
  return chunks.map((content, ordinal) => ({ ordinal, content }));
}

function validateChunkBudget(maxChars: number, overlapChars: number): void {
  if (maxChars <= 0 || overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error("Require maxChars > 0 and 0 <= overlapChars < maxChars.");
  }
}

function chunkContent(text: string, maxChars: number, overlapChars: number, preserveParagraphs: boolean): string[] {
  validateChunkBudget(maxChars, overlapChars);
  const parts = normalize(text)
    .split(/\n\n+/)
    .flatMap((paragraph) => sentences(paragraph, maxChars, preserveParagraphs).map((part, index) => ({
      part,
      separator: preserveParagraphs && index === 0 ? "\n\n" : " "
    })));
  const chunks: string[] = [];
  let current = "";

  for (const { part, separator } of parts) {
    const candidate = current ? current + separator + part : part;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = trailingOverlap(current, overlapChars);
    }
    if (current && (current + separator + part).length > maxChars) {
      if (!preserveParagraphs) chunks.push(current);
      current = "";
    }
    current = current ? current + separator + part : part;
  }

  if (current) chunks.push(current);
  return chunks;
}

