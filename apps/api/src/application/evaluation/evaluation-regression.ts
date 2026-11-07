import { z } from "zod";
import { replayMetricsSchema } from "./replay-benchmark.js";

const datasetIdentity = z.object({ version: z.string(), digest: z.string().regex(/^[a-f0-9]{64}$/), total: z.number().int().positive() });
const rate = z.number().min(0).max(1).nullable();

export const evaluationSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  replay: datasetIdentity.extend({ topK: z.number().int().positive(), metrics: replayMetricsSchema }),
  security: datasetIdentity.extend({ screening: z.object({ detectionRecall: rate, detectionPrecision: rate, falsePositiveRate: rate }) })
});

export type EvaluationSnapshot = z.infer<typeof evaluationSnapshotSchema>;

export function compareEvaluationSnapshots(current: EvaluationSnapshot, baseline: EvaluationSnapshot) {
  if (current.replay.digest !== baseline.replay.digest || current.security.digest !== baseline.security.digest) {
    return { comparable: false, passed: false, regressions: [] };
  }
  const candidates = { ...current.replay.metrics, ...current.security.screening };
  const references = { ...baseline.replay.metrics, ...baseline.security.screening };
  const regressions = (Object.keys(candidates) as (keyof typeof candidates)[]).flatMap((metric) => {
    const actual = candidates[metric];
    const expected = references[metric];
    if (expected === null) return [];
    const lowerIsBetter = metric === "falsePositiveRate";
    const worse = actual === null || (lowerIsBetter ? actual > expected + 1e-9 : actual < expected - 1e-9);
    return worse ? [{ metric, expected, actual, direction: lowerIsBetter ? "maximum" : "minimum" }] : [];
  });
  return { comparable: true, passed: regressions.length === 0, regressions };
}
