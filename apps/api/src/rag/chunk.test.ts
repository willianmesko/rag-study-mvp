import assert from "node:assert/strict";
import test from "node:test";
import { chunkText } from "../domain/chunk.js";

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

