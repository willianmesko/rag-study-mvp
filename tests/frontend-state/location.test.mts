import assert from "node:assert/strict";
import test from "node:test";
import { chatRunIdSchema, documentFiltersSchema } from "@rag-study/contracts";
import { canonicalPrivatePath, conversationIdFromLocation, conversationPath, documentFiltersFromLocation, knowledgePath } from "../../apps/web/src/shared/lib/app-route.ts";
import { browserLocation, navigationRevision, subscribeBrowserLocation } from "../../apps/web/src/shared/lib/browser-location.ts";

const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

test("page codecs serialize only validated metadata and conversation IDs", () => {
  const path = knowledgePath({ documentId: id, language: "pt", format: "pdf", from: "2026-01-01", to: "2026-11-07", q: "private question", source: "private/source" });
  assert.equal(path, `/workspace/knowledge?documentId=${id}&language=pt&format=pdf&from=2026-01-01&to=2026-11-07`);
  assert.deepEqual(documentFiltersFromLocation(path), { documentId: id, language: "pt", format: "pdf", from: "2026-01-01", to: "2026-11-07" });
  assert.deepEqual(documentFiltersFromLocation("/workspace/knowledge?language=pt&format=pdf&token=secret&q=private&source=private"), { language: "pt", format: "pdf" });
  assert.equal(canonicalPrivatePath(`/ask?conversation=${id.toUpperCase()}&token=secret&question=private`), conversationPath(id));
  assert.equal(conversationIdFromLocation(`/ask?conversation=${id}`), id);
  assert.equal(conversationIdFromLocation(`/search?conversation=${id}`), null);
  assert.equal(canonicalPrivatePath("/workspace/team?token=secret&question=private"), "/workspace/team");
  assert.equal(canonicalPrivatePath("https://outside.invalid/ask?token=secret"), "/workspace/overview");
});

test("ambiguous IDs, dates, formats and navigation queries cannot reach page state", () => {
  for (const query of [`conversation=${id}&conversation=${id}`, "conversation=javascript%3Aalert(1)", "conversation=not-a-uuid"])
    assert.equal(canonicalPrivatePath(`/ask?${query}`), "/ask");
  for (const query of ["from=2026-02-30", "from=2026-11-07&to=2026-01-01", "language=not-a-language", "format=exe", "documentId=not-a-uuid"])
    assert.deepEqual(documentFiltersFromLocation(`/workspace/knowledge?${query}`), {});
  assert.deepEqual(documentFiltersFromLocation("/workspace/knowledge?language=pt&format=pdf&format=text"), { language: "pt" });
  assert.equal(canonicalPrivatePath("/workspace/invalid?question=private"), "/workspace/overview");
  assert.equal(knowledgePath({ from: "2026-11-07", to: "2026-01-01" }), "/workspace/knowledge");
});

test("native location store owns one listener and releases it after the last subscriber", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = new EventTarget(), location = { pathname: "/ask", search: "" };
  let attached = 0, removed = 0, first = 0, second = 0;
  const dispose: Array<() => void> = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location,
    addEventListener: (name: string, listener: EventListener) => { attached++; target.addEventListener(name, listener); },
    removeEventListener: (name: string, listener: EventListener) => { removed++; target.removeEventListener(name, listener); },
  } });
  try {
    dispose.push(subscribeBrowserLocation(() => first++), subscribeBrowserLocation(() => second++));
    assert.equal(attached, 1); assert.equal(browserLocation(), "/ask");
    const revision = navigationRevision(); location.search = `?conversation=${id}`; target.dispatchEvent(new Event("popstate"));
    assert.deepEqual([first, second], [1, 1]); assert.equal(navigationRevision(), revision + 1);
    target.dispatchEvent(new Event("popstate")); assert.deepEqual([first, second], [1, 1]);
    dispose[0](); assert.equal(removed, 0);
    location.pathname = "/history"; location.search = ""; target.dispatchEvent(new Event("popstate"));
    assert.deepEqual([first, second], [1, 2]); dispose[1](); dispose[1](); assert.equal(removed, 1);
  } finally {
    dispose.forEach((stop) => stop());
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("bootstrap URL grammar agrees with the shared request schema for boundary values", () => {
  const ids = [id, id.toUpperCase(), "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "aaaaaaaa-aaaa-0aaa-aaaa-aaaaaaaaaaaa", "aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa", "../private", "", " null "];
  for (const value of ids) {
    const accepted = chatRunIdSchema.safeParse(value.toLowerCase()).success;
    assert.equal(conversationIdFromLocation(`/ask?conversation=${encodeURIComponent(value)}`), accepted ? value.toLowerCase() : null);
  }
  const cases = [
    {}, { documentId: id }, { documentId: "not-uuid" }, { language: "en" }, { language: "pt" },
    { language: "mixed" }, { language: "und" }, { language: "EN" },
    ...["pdf", "docx", "html", "markdown", "text", "PDF", "exe"].map((format) => ({ format })),
    ...["2024-02-29", "2026-02-29", "2026-02-30", "0000-01-01", "0099-01-01", "9999-12-31", "2026-1-01", ""].map((from) => ({ from })),
    { from: "2026-01-01", to: "2026-11-07" }, { from: "2026-11-07", to: "2026-01-01" },
    { language: "pt", format: "pdf", documentId: id, from: "2026-11-07", to: "2026-11-07" }
  ];
  for (const value of cases) {
    const parsed = documentFiltersSchema.safeParse(value);
    const params = new URLSearchParams(Object.entries(value));
    assert.deepEqual(documentFiltersFromLocation(`/workspace/knowledge?${params}`), parsed.success ? parsed.data : {});
  }
});
