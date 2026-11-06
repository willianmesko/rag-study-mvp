import assert from "node:assert/strict";
import test from "node:test";
import { toLexicalQuery } from "./lexical-query.js";

test("lexical query keeps substantive Portuguese terms while removing question stopwords", () => {
  assert.equal(toLexicalQuery("Qual é a troca do HNSW?"), "troca hnsw");
});

test("lexical query leaves the original language handling to embeddings when it has no usable terms", () => {
  assert.equal(toLexicalQuery("O que é?"), "");
});
