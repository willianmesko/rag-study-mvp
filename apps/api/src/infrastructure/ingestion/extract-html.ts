import { defaultTreeAdapter, parse, type DefaultTreeAdapterTypes } from "parse5";
import type { DocumentSection } from "../../domain/chunk.js";
import { readLanguageHint } from "./document-language.js";
import { validateSectionCount } from "./document-sections.js";

type Node = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;

const MAX_HTML_LENGTH = 1_000_000;
const MAX_DEPTH = 128;
const ignoredTags = new Set([
  "aside", "audio", "button", "canvas", "embed", "footer", "form", "iframe", "input", "math", "nav", "noscript", "object",
  "script", "select", "style", "svg", "template", "textarea", "video"
]);
const blockTags = new Set([
  "address", "article", "blockquote", "dd", "div", "dl", "dt", "figcaption", "figure", "header", "hr", "li", "ol",
  "p", "pre", "section", "table", "tr", "ul"
]);

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((item) => item.name === name)?.value;
}

function ignored(element: Element): boolean {
  const role = attribute(element, "role")?.trim().toLowerCase();
  const style = attribute(element, "style") ?? "";
  return ignoredTags.has(element.tagName) || role === "navigation" || role === "contentinfo" || role === "banner" ||
    attribute(element, "hidden") !== undefined || attribute(element, "inert") !== undefined ||
    attribute(element, "aria-hidden")?.trim().toLowerCase() === "true" ||
    /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(style);
}

function assertDepth(depth: number): void {
  if (depth > MAX_DEPTH) throw new Error("The HTML document is nested too deeply.");
}

function findMain(node: Element, depth = 0): Element | undefined {
  assertDepth(depth);
  if (ignored(node)) return undefined;
  if (node.tagName === "main" || attribute(node, "role")?.trim().toLowerCase() === "main") return node;
  for (const child of node.childNodes) {
    if (!defaultTreeAdapter.isElementNode(child)) continue;
    const main = findMain(child, depth + 1);
    if (main) return main;
  }
}

function normalizedInline(text: string): string {
  return text.replace(/[\s\u0000]+/gu, " ").trim();
}

function inlineText(node: Node, depth = 0): string {
  assertDepth(depth);
  if (defaultTreeAdapter.isTextNode(node)) return node.value;
  if (!defaultTreeAdapter.isElementNode(node) || ignored(node)) return "";
  if (node.tagName === "br") return " ";
  return node.childNodes.map((child) => inlineText(child, depth + 1)).join("");
}

function readSections(root: Element): { sections: DocumentSection[]; title?: string } {
  const sections: DocumentSection[] = [];
  let title: string | undefined;
  let heading: string | undefined;
  let parts: string[] = [];

  function flush(nextHeading?: string) {
    const text = parts.join("").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (heading || text) {
      sections.push(heading ? { heading, text } : { text });
      validateSectionCount(sections.length);
    }
    heading = nextHeading;
    parts = [];
  }

  function visit(node: Node, depth: number, preformatted = false) {
    assertDepth(depth);
    if (defaultTreeAdapter.isTextNode(node)) {
      parts.push(preformatted ? node.value : node.value.replace(/\s+/gu, " "));
      return;
    }
    if (!defaultTreeAdapter.isElementNode(node) || ignored(node)) return;
    if (node.tagName === "header" && node.parentNode === root && root.tagName === "body") return;
    if (/^h[1-6]$/.test(node.tagName)) {
      const label = normalizedInline(inlineText(node, depth));
      if (label) {
        if (node.tagName === "h1") title ??= label;
        flush(label);
      }
      return;
    }
    if (node.tagName === "br") {
      parts.push("\n");
      return;
    }
    const block = blockTags.has(node.tagName);
    if (block) parts.push("\n\n");
    for (const child of node.childNodes) visit(child, depth + 1, preformatted || node.tagName === "pre");
    if (block) parts.push("\n\n");
    if (node.tagName === "td" || node.tagName === "th") parts.push(" ");
  }

  visit(root, 0);
  flush();
  return { sections, title };
}

function childElements(node: Element | DefaultTreeAdapterTypes.Document | undefined): Element[] {
  return node?.childNodes.filter(defaultTreeAdapter.isElementNode) ?? [];
}

export function extractHtml(html: string): {
  sections: DocumentSection[];
  title?: string;
  description?: string;
  languageHint?: string;
} {
  if (html.length > MAX_HTML_LENGTH) throw new Error("The HTML document exceeds the 1,000,000 character parsing limit.");
  const root = childElements(parse(html)).find(({ tagName }) => tagName === "html");
  const children = childElements(root);
  const head = childElements(children.find(({ tagName }) => tagName === "head"));
  const body = children.find(({ tagName }) => tagName === "body");
  if (!body || ignored(body) || (root && ignored(root))) return { sections: [] };

  const title = head.find(({ tagName }) => tagName === "title");
  const metadata = head.filter(({ tagName }) => tagName === "meta");
  const description = metadata.find((element) => attribute(element, "name")?.trim().toLowerCase() === "description") ??
    metadata.find((element) => attribute(element, "property")?.trim().toLowerCase() === "og:description");
  const structure = readSections(findMain(body) ?? body);
  const titleText = (title && normalizedInline(inlineText(title))) || structure.title;
  return {
    sections: structure.sections,
    title: titleText?.slice(0, 500).trimEnd(),
    description: description ? normalizedInline(attribute(description, "content") ?? "").slice(0, 1_000).trimEnd() || undefined : undefined,
    languageHint: readLanguageHint(root ? attribute(root, "lang") : undefined)
  };
}
