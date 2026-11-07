import assert from "node:assert/strict";
import test from "node:test";
import { replaySuiteSchema } from "./replay-benchmark.js";
import { approveReviewedReplay, assertReviewedReplayApproved, replayReviewApprovalSchema, replayReviewAttestationSchema } from "./reviewed-replay.js";

const example = {
  version: "1.0", topK: 2, cases: [{ id: "example-001", provenance: "reviewed-anonymized", question: "What is the sample retention period?", candidates: [
    { id: "retention", text: "Test records are kept for five days.", relevant: true },
    { id: "access", text: "Only test team members can see the records.", relevant: false }
  ] }]
};
const attestation = replayReviewAttestationSchema.parse({
  reviewCode: "review-fixture", reviewedOn: "2026-01-05", checks: {
    useAuthorized: true, identitiesAndSecretsRemoved: true, identifyingCombinationsGeneralized: true, evidenceMinimizedAndLabelsChecked: true
  }
});

test("an anonymized replay requires explicit review bound to the exact suite", () => {
  const suite = replaySuiteSchema.parse(example);
  assert.throws(() => assertReviewedReplayApproved(suite), /review receipt/);
  const receipt = replayReviewApprovalSchema.parse(approveReviewedReplay(suite, attestation));
  assert.doesNotThrow(() => assertReviewedReplayApproved(suite, receipt));
  assert.throws(() => assertReviewedReplayApproved({ ...suite, topK: 1 }, receipt), /exact anonymized suite/);
  assert.doesNotMatch(JSON.stringify(receipt), /retention period|five days/);
});

test("a partial attestation fails and synthetic cases remain runnable without review", () => {
  const suite = replaySuiteSchema.parse({ ...example, cases: [{ ...example.cases[0], provenance: "synthetic" }] });
  assert.equal(replayReviewAttestationSchema.safeParse({ ...attestation, checks: { ...attestation.checks, useAuthorized: false } }).success, false);
  assert.doesNotThrow(() => assertReviewedReplayApproved(suite));
  assert.throws(() => approveReviewedReplay(suite, attestation), /only to a suite/);
});
