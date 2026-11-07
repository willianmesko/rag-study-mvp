import assert from "node:assert/strict";
import test from "node:test";
import { comparePerformanceRuns, performanceRunsSchema } from "./performance-gate.js";

const limits = { minimumSamples: 2, maxP95LatencyMs: 200, maxMeanCostUsd: 0.001,
  maxLatencyIncreasePercent: 20, maxCostIncreasePercent: 10 };

function runs(commitSha: string, latencyMs: number, costUsd: number, costSource: "observed" | "estimated" = "observed") {
  return performanceRunsSchema.parse({ run: {
    chatProvider: "openrouter", chatModel: "test-model", datasetVersion: "1.0", commitSha,
    failureDetails: { quality: { faithfulness: {
      method: "public-claim-evidence-judge", version: "1.0", status: "completed", judgeModel: "test-judge",
      effort: "standard", promptVersion: "grounded-v1", maxOutputTokens: 500, datasetDigest: "a".repeat(64),
      totalCases: 2, calibration: { version: "1.0" },
      generationCases: ["case-a", "case-b"].map((caseId) => ({ caseId, score: 1, latencyMs, costUsd, costSource }))
    } } }
  } });
}

test("performance gate applies relative and absolute bounds to comparable versions", () => {
  const baseline = runs("previous", 100, 0.0002);
  const pass = comparePerformanceRuns(baseline, runs("current", 115, 0.00021), limits);
  assert.equal(pass.passed, true);
  assert.equal(pass.baseline.costSource, "observed");
  const fail = comparePerformanceRuns(baseline, runs("current", 121, 0.00023), limits);
  assert.deepEqual(fail.failures, ["p95_latency_regressed", "mean_cost_regressed"]);
  assert.deepEqual(comparePerformanceRuns(baseline, runs("current", 100, 0.0002), { ...limits, minimumSamples: 3 }).failures, ["insufficient_samples"]);
});

test("performance gate rejects incompatible evidence and cost measurement bases", () => {
  const baseline = runs("previous", 100, 0.0002);
  assert.throws(() => comparePerformanceRuns(baseline, runs("current", 100, 0.0002, "estimated"), limits), /same fixtures/);
  const incomplete = runs("current", 100, 0.0002);
  incomplete[0]!.failureDetails.quality.faithfulness.generationCases[0]!.score = null;
  assert.throws(() => comparePerformanceRuns(baseline, incomplete, limits), /scored evidence/);
});
