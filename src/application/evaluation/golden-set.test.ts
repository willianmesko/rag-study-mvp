import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRetrieval, goldenSetSchema } from "./golden-set.js";

test("golden-set evaluation computes hit rate and MRR from retrieved sources", () => {
  const goldenSet = goldenSetSchema.parse({
    version: "1", name: "test", thresholds: { hitRate: 0.5, meanReciprocalRank: 0.5 },
    cases: [
      { id: "first", question: "one", expectedSources: ["expected/a"] },
      { id: "second", question: "two", expectedSources: ["expected/b"] }
    ]
  });
  const result = evaluateRetrieval(goldenSet, new Map([
    ["first", [
      { chunkId: "1", documentId: "1", ordinal: 0, content: "noise", source: "noise", title: null, score: 0.8, security: { promptInjectionRisk: "low", signals: [] } },
      { chunkId: "2", documentId: "1", ordinal: 1, content: "match", source: "expected/a", title: null, score: 0.7, security: { promptInjectionRisk: "low", signals: [] } }
    ]],
    ["second", []]
  ]));

  assert.equal(result.hits, 1);
  assert.equal(result.hitRate, 0.5);
  assert.equal(result.meanReciprocalRank, 0.25);
  assert.equal(result.passed, false);
  assert.deepEqual(result.failedCases[0]?.returnedSources, []);
});
