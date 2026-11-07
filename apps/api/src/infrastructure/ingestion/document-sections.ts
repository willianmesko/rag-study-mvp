import type { DocumentSection } from "../../domain/chunk.js";

const MAX_SECTIONS = 1_000;

export function validateSectionCount(count: number): void {
  if (count > MAX_SECTIONS) throw new Error("The document has more than 1,000 sections. Split it into smaller files and try again.");
}

export function sectionText(sections: readonly DocumentSection[]): string {
  return sections.map(({ heading, text }) => [heading, text].filter(Boolean).join("\n\n")).join("\n\n");
}

export function extractMarkdownSections(text: string): { sections: DocumentSection[]; title?: string } {
  const sections: DocumentSection[] = [];
  let title: string | undefined;
  let heading: string | undefined;
  let lines: string[] = [];
  let fence: string | undefined;
  const source = text.split(/\r?\n/);

  function startSection(nextHeading?: string) {
    const body = lines.join("\n").trim();
    if (body || heading) {
      sections.push(heading ? { heading, text: body } : { text: body });
      validateSectionCount(sections.length);
    }
    heading = nextHeading;
    lines = [];
  }

  for (let index = 0; index < source.length; index++) {
    const line = source[index]!;
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (fenceMatch?.[1]?.startsWith(fence) && !fenceMatch[2]?.trim()) fence = undefined;
      lines.push(line);
      continue;
    }
    if (fenceMatch?.[1] && (fenceMatch[1][0] === "~" || !fenceMatch[2]?.includes("`"))) {
      fence = fenceMatch[1];
      lines.push(line);
      continue;
    }

    const atx = /^ {0,3}(#{1,6})(?:[ \t]+|$)/.exec(line);
    const label = atx && line.slice(atx[0].length).trim().replace(/(?:^|[ \t])#+$/, "").trimEnd();
    if (label) {
      if (atx?.[1] === "#") title ??= label;
      startSection(label);
      continue;
    }
    // Single-line Setext headings are supported outside lists and code blocks.
    const setext = /^(?: {0,3})(?:=+|-+)[ \t]*$/.test(source[index + 1] ?? "");
    const headingCandidate = /^ {0,3}[^\s#>+*`~\-]/.test(line) && !/^ {0,3}\d+[.)][ \t]/.test(line);
    if (setext && headingCandidate && !source[index - 1]?.trim()) {
      if (source[index + 1]?.trimStart().startsWith("=")) title ??= line.trim();
      startSection(line.trim());
      index++;
      continue;
    }
    lines.push(line);
  }
  startSection();
  return { sections, title: title?.slice(0, 500).trimEnd() };
}
