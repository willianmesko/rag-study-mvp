import assert from "node:assert/strict";
import test from "node:test";
import { redactPii } from "./pii-redaction.js";

test("PII redaction removes common direct identifiers before provider calls", () => {
  const result = redactPii("Contact ana@example.com on +55 (11) 99999-8888. CPF 123.456.789-01.");
  assert.equal(result.text.includes("ana@example.com"), false);
  assert.equal(result.text.includes("99999-8888"), false);
  assert.equal(result.text.includes("123.456.789-01"), false);
  assert.deepEqual(result.categories.sort(), ["cpf", "email", "phone"]);
  assert.equal(result.count, 3);
});
