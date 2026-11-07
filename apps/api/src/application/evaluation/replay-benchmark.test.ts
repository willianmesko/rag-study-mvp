import assert from "node:assert/strict";
import test from "node:test";
import { compareEvaluationSnapshots, type EvaluationSnapshot } from "./evaluation-regression.js";
import { evaluateReplay, replaySuiteSchema, scoreReplayRanking } from "./replay-benchmark.js";

const fixture = {
  version: "1.0", topK: 1,
  cases: [{ id: "case-a", provenance: "synthetic", question: "What is the retention window?", candidates: [
    { id: "distractor", relevant: false, text: "The retention window is displayed in the workspace settings." },
    { id: "evidence", relevant: true, text: "Exports expire after seven days." }
  ] }]
};

test("reranking reorders the same safe candidates and compares their ranked relevance", async () => {
  const report = await evaluateReplay(replaySuiteSchema.parse(fixture), {
    enabled: true,
    async rerank({ candidates, limit }) {
      assert.deepEqual(candidates.map(({ chunkId }) => chunkId), ["distractor", "evidence"]);
      assert.equal(limit, 1);
      return [candidates[1]!];
    }
  });
  assert.equal(report.baseline.hitRate, 0);
  assert.equal(report.reranked?.contextPrecision, 1);
  assert.equal(report.reranked?.recallAtK, 1);
  assert.doesNotMatch(JSON.stringify(report), /retention window|Exports expire/);
});

test("reviewed private replay data stays offline and detected identifiers fail validation", async () => {
  const edited = structuredClone(fixture);
  edited.cases[0]!.provenance = "reviewed-anonymized";
  const suite = replaySuiteSchema.parse(edited);
  assert.equal((await evaluateReplay(suite)).cases.length, 1);
  await assert.rejects(evaluateReplay(suite, { enabled: true, rerank: async () => assert.fail("External call attempted.") }), /synthetic/);
  edited.cases[0]!.question = "Why did person@example.test lose access?";
  assert.equal(replaySuiteSchema.safeParse(edited).success, false);
});

test("ranked metrics distinguish late relevance from a missed relevant passage", () => {
  const metrics = scoreReplayRanking(["unrelated", "relevant-one"], new Set(["relevant-one", "relevant-two"]), 2);
  assert.deepEqual(metrics, { hitRate: 1, meanReciprocalRank: 0.5, recallAtK: 0.5, precisionAtK: 0.5, contextPrecision: 0.25 });
});

test("version comparisons fail on a metric decline, more false positives, or changed fixtures", () => {
  const baseline: EvaluationSnapshot = {
    schemaVersion: 1,
    replay: { version: "1.0", digest: "a".repeat(64), topK: 1, total: 1, metrics: scoreReplayRanking(["a"], new Set(["a"]), 1) },
    security: { version: "1.0", digest: "b".repeat(64), total: 2, screening: { detectionRecall: 1, detectionPrecision: 1, falsePositiveRate: 0 } }
  };
  assert.equal(compareEvaluationSnapshots(baseline, baseline).passed, true);
  const current = structuredClone(baseline);
  current.replay.metrics.recallAtK = 0;
  current.security.screening.falsePositiveRate = 0.5;
  const result = compareEvaluationSnapshots(current, baseline);
  assert.equal(result.passed, false);
  assert.deepEqual(result.regressions.map(({ metric }) => metric), ["recallAtK", "falsePositiveRate"]);
  current.replay.digest = "c".repeat(64);
  assert.equal(compareEvaluationSnapshots(current, baseline).comparable, false);
});
