import assert from "node:assert/strict";
import test from "node:test";
import { chunkSections, chunkText } from "./chunk.js";

test("chunkText keeps every chunk within the configured character budget", () => {
  const chunks = chunkText(
    "One short sentence. Two short sentences follow. Three short sentences complete this document.",
    45,
    10
  );
  assert.ok(chunks.length > 1);
  assert.deepEqual(chunks.map((chunk) => chunk.ordinal), chunks.map((_, index) => index));
  assert.ok(chunks.every((chunk) => chunk.content.length <= 45));
});

test("chunkText splits a word-like run that is longer than the budget", () => {
  const chunks = chunkText("a".repeat(101), 40, 5);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((chunk) => chunk.content.length), [40, 40, 21]);
});

test("structure-aware chunks preserve paragraph breaks and text containing punctuation inside words", () => {
  const chunks = chunkSections([
    { heading: "Support", text: "See https://example.com/help.\n\nCall +1.555.0000 for help." },
    { heading: "Policy", text: "Do not share internal material." }
  ], 100, 15);

  assert.deepEqual(chunks, [
    { ordinal: 0, content: "Support\n\nSee https://example.com/help.\n\nCall +1.555.0000 for help." },
    { ordinal: 1, content: "Policy\n\nDo not share internal material." }
  ]);
});

test("section headings are repeated within the chunk budget and overlap never crosses section boundaries", () => {
  const heading = "Operations and escalation guidance for every member of the workspace";
  const chunks = chunkSections([
    { heading, text: "Review this policy before escalating. Contact your manager with the details. The team records each decision." },
    { heading: "Approvals", text: "Different section text." }
  ], 58, 15);

  assert.ok(chunks.length > 2);
  assert.ok(chunks.every(({ content }) => content.length <= 58));
  assert.deepEqual(chunks.map(({ ordinal }) => ordinal), chunks.map((_, index) => index));
  assert.ok(chunks.slice(0, -1).every(({ content }) => content.startsWith("Operations and esca\n\n")));
  assert.equal(chunks.at(-1)?.content, "Approvals\n\nDifferent section text.");
});

