import assert from "node:assert/strict";
import test from "node:test";
import { toLexicalQuery } from "./lexical-query.js";

test("lexical query keeps substantive terms while removing question stopwords", () => {
  assert.equal(toLexicalQuery("What is the HNSW trade-off?"), "hnsw trade-off");
});

test("lexical query leaves original language handling to embeddings when it has no usable terms", () => {
  assert.equal(toLexicalQuery("What is?"), "");
});
