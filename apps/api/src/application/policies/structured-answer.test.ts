import assert from "node:assert/strict";
import test from "node:test";
import { parseGroundedAnswer, validateGroundedAnswer } from "./structured-answer.js";

test("structured answer parser accepts JSON and preserves citations", () => {
  const result = parseGroundedAnswer('{"answer":"Grounded.","citedChunkIds":["chunk-1"],"refusalReason":null}');
  assert.equal(result.structured, true);
  assert.deepEqual(result.citedChunkIds, ["chunk-1"]);
});

test("structured answer validator rejects citations outside retrieved context", () => {
  const result = validateGroundedAnswer(parseGroundedAnswer('{"answer":"Unsafe.","citedChunkIds":["chunk-x"]}'), new Set(["chunk-1"]));
  assert.equal(result.refusalReason, "invalid_citations");
  assert.deepEqual(result.citedChunkIds, []);
});

test("a structured answer needs at least one source unless it declines the question", () => {
  const allowed = new Set(["S1"]);
  const answer = parseGroundedAnswer('{"answer":"Unsupported.","citedChunkIds":[]}');
  assert.equal(validateGroundedAnswer(answer, allowed).refusalReason, "invalid_citations");
  assert.equal(validateGroundedAnswer({ ...answer, refusalReason: "insufficient_context" }, allowed).refusalReason, "insufficient_context");
});

test("parser keeps legacy plain-text providers usable but marks them unstructured", () => {
  const result = parseGroundedAnswer("A plain-text answer.");
  assert.equal(result.structured, false);
  assert.equal(result.answer, "A plain-text answer.");
});
