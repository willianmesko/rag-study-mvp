import { expect, test } from "@playwright/test";
import { chatRunIdSchema, documentFiltersSchema } from "@rag-study/contracts";
import { canonicalPrivatePath, conversationIdFromLocation, conversationPath, documentFiltersFromLocation, knowledgePath } from "../../apps/web/src/shared/lib/app-route";
import { browserLocation, navigationRevision, subscribeBrowserLocation } from "../../apps/web/src/shared/lib/browser-location";

const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

test("FE-11 page codecs serialize only validated scope-independent metadata and conversation IDs", () => {
  const path = knowledgePath({ documentId: id, language: "pt", format: "pdf", from: "2026-01-01", to: "2026-11-07", q: "private question", source: "private/source" });
  expect(path).toBe(`/workspace/knowledge?documentId=${id}&language=pt&format=pdf&from=2026-01-01&to=2026-11-07`);
  expect(documentFiltersFromLocation(path)).toEqual({ documentId: id, language: "pt", format: "pdf", from: "2026-01-01", to: "2026-11-07" });
  expect(documentFiltersFromLocation("/workspace/knowledge?language=pt&format=pdf&token=secret&q=private&source=private")).toEqual({ language: "pt", format: "pdf" });
  expect(canonicalPrivatePath(`/ask?conversation=${id.toUpperCase()}&token=secret&question=private`)).toBe(conversationPath(id));
  expect(conversationIdFromLocation(`/ask?conversation=${id}`)).toBe(id);
  expect(conversationIdFromLocation(`/search?conversation=${id}`)).toBeNull();
  expect(canonicalPrivatePath("/workspace/team?token=secret&question=private")).toBe("/workspace/team");
  expect(canonicalPrivatePath("https://outside.invalid/ask?token=secret")).toBe("/workspace/overview");
});

test("FE-11 ambiguous IDs, dates, formats and navigation queries cannot reach page state", () => {
  for (const query of [`conversation=${id}&conversation=${id}`, "conversation=javascript%3Aalert(1)", "conversation=not-a-uuid"])
    expect(canonicalPrivatePath(`/ask?${query}`)).toBe("/ask");
  for (const query of ["from=2026-02-30", "from=2026-11-07&to=2026-01-01", "language=not-a-language", "format=exe", "documentId=not-a-uuid"])
    expect(documentFiltersFromLocation(`/workspace/knowledge?${query}`)).toEqual({});
  expect(documentFiltersFromLocation("/workspace/knowledge?language=pt&format=pdf&format=text")).toEqual({ language: "pt" });
  expect(canonicalPrivatePath("/workspace/invalid?question=private")).toBe("/workspace/overview");
  expect(knowledgePath({ from: "2026-11-07", to: "2026-01-01" })).toBe("/workspace/knowledge");
});

test("FE-11 the native location store owns one listener and releases it after the last subscriber", () => {
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
    expect(attached).toBe(1); expect(browserLocation()).toBe("/ask");
    const revision = navigationRevision(); location.search = `?conversation=${id}`; target.dispatchEvent(new Event("popstate"));
    expect([first, second]).toEqual([1, 1]); expect(navigationRevision()).toBe(revision + 1);
    target.dispatchEvent(new Event("popstate")); expect([first, second]).toEqual([1, 1]);
    dispose[0](); expect(removed).toBe(0);
    location.pathname = "/history"; location.search = ""; target.dispatchEvent(new Event("popstate"));
    expect([first, second]).toEqual([1, 2]);
    dispose[1](); dispose[1](); expect(removed).toBe(1);
  } finally {
    dispose.forEach((stop) => stop());
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});


test("FE-11 bootstrap URL grammar agrees with the shared request schema for boundary values", () => {
  const ids = [id, id.toUpperCase(), "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "aaaaaaaa-aaaa-0aaa-aaaa-aaaaaaaaaaaa", "aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa", "../private", "", " null "];
  for (const value of ids) {
    const accepted = chatRunIdSchema.safeParse(value.toLowerCase()).success;
    expect(conversationIdFromLocation(`/ask?conversation=${encodeURIComponent(value)}`)).toBe(accepted ? value.toLowerCase() : null);
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
    const path = `/workspace/knowledge?${new URLSearchParams(value)}`;
    expect(documentFiltersFromLocation(path)).toEqual(parsed.success ? parsed.data : {});
  }
});
