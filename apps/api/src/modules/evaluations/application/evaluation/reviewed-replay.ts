import { z } from "zod";
import { benchmarkFingerprint, type ReplaySuite } from "./replay-benchmark.js";

export const replayReviewAttestationSchema = z.strictObject({
  reviewCode: z.string().regex(/^review-[a-z0-9-]{3,32}$/),
  reviewedOn: z.iso.date(),
  checks: z.strictObject({
    useAuthorized: z.literal(true),
    identitiesAndSecretsRemoved: z.literal(true),
    identifyingCombinationsGeneralized: z.literal(true),
    evidenceMinimizedAndLabelsChecked: z.literal(true)
  })
});

export const replayReviewApprovalSchema = replayReviewAttestationSchema.extend({
  schemaVersion: z.literal(1),
  suiteDigest: z.string().regex(/^[a-f0-9]{64}$/)
});

type ReplayReviewAttestation = z.infer<typeof replayReviewAttestationSchema>;
export type ReplayReviewApproval = z.infer<typeof replayReviewApprovalSchema>;

export function approveReviewedReplay(suite: ReplaySuite, attestation: ReplayReviewAttestation): ReplayReviewApproval {
  if (!suite.cases.some(({ provenance }) => provenance === "reviewed-anonymized")) {
    throw new Error("A review receipt applies only to a suite with manually reconstructed, anonymized cases.");
  }
  return { schemaVersion: 1, suiteDigest: benchmarkFingerprint(suite), ...attestation };
}

export function assertReviewedReplayApproved(suite: ReplaySuite, approval?: ReplayReviewApproval | null): void {
  if (!suite.cases.some(({ provenance }) => provenance === "reviewed-anonymized")) return;
  if (approval?.suiteDigest !== benchmarkFingerprint(suite)) {
    throw new Error("Provide a review receipt for this exact anonymized suite before replaying it.");
  }
}
