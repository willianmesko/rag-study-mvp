import { z } from "zod";

const caseSample = z.object({
  caseId: z.string().min(1).max(80), score: z.number().min(0).max(1).nullable(),
  latencyMs: z.number().int().nonnegative().nullable(), costUsd: z.number().nonnegative().nullable(),
  costSource: z.enum(["observed", "estimated"]).nullable()
});

const evaluationExport = z.object({
  chatProvider: z.string().min(1), chatModel: z.string().min(1), datasetVersion: z.string().min(1), commitSha: z.string().nullable(),
  failureDetails: z.object({ quality: z.object({ faithfulness: z.object({
    method: z.literal("public-claim-evidence-judge"), version: z.string().min(1), status: z.literal("completed"),
    judgeModel: z.string().min(1), effort: z.enum(["compact", "standard", "extended"]),
    promptVersion: z.string().min(1), maxOutputTokens: z.number().int().positive(),
    datasetDigest: z.string().regex(/^[a-f0-9]{64}$/), totalCases: z.number().int().positive(),
    calibration: z.object({ version: z.string().min(1) }), generationCases: z.array(caseSample).min(1).max(50)
  }) }) })
});

const exportEnvelope = z.union([evaluationExport, z.object({ run: evaluationExport }).transform(({ run }) => run)]);
export const performanceRunsSchema = z.union([exportEnvelope.transform((run) => [run]), z.array(exportEnvelope).min(1).max(50)]);
export const performanceThresholdsSchema = z.strictObject({
  minimumSamples: z.number().int().min(2).max(2_500),
  maxP95LatencyMs: z.number().int().positive(),
  maxMeanCostUsd: z.number().nonnegative(),
  maxLatencyIncreasePercent: z.number().nonnegative(),
  maxCostIncreasePercent: z.number().nonnegative()
});

type ExportedRun = z.infer<typeof evaluationExport>;
type PerformanceThresholds = z.infer<typeof performanceThresholdsSchema>;

function summarize(runs: ExportedRun[]) {
  const reference = runs[0]!;
  const refQuality = reference.failureDetails.quality.faithfulness;
  const workload = (run: ExportedRun) => {
    const quality = run.failureDetails.quality.faithfulness;
    return JSON.stringify([run.chatProvider, run.chatModel, run.datasetVersion, quality.version, quality.datasetDigest,
      quality.promptVersion, quality.judgeModel, quality.calibration.version, quality.effort, quality.maxOutputTokens,
      quality.generationCases.map(({ caseId }) => caseId).sort()]);
  };
  const identity = workload(reference);
  const latencies: number[] = [];
  const costs: number[] = [];
  let costSource: "observed" | "estimated" | undefined;
  for (const run of runs) {
    const { generationCases, totalCases } = run.failureDetails.quality.faithfulness;
    if (identity !== workload(run) || run.commitSha !== reference.commitSha || generationCases.length !== totalCases
      || new Set(generationCases.map(({ caseId }) => caseId)).size !== totalCases) {
      throw new Error("A performance export must contain complete runs from one workload and revision.");
    }
    for (const sample of generationCases) {
      if (sample.score === null || sample.latencyMs === null || sample.costUsd === null || !sample.costSource) {
        throw new Error("Every performance sample needs scored evidence, latency, and cost provenance.");
      }
      if (costSource && sample.costSource !== costSource) throw new Error("Use a consistent measured or estimated cost basis.");
      costSource = sample.costSource;
      latencies.push(sample.latencyMs);
      costs.push(sample.costUsd);
    }
  }
  latencies.sort((left, right) => left - right);
  return { identity, costSource, commitSha: reference.commitSha, model: reference.chatModel, effort: refQuality.effort,
    sampleCount: latencies.length, p95LatencyMs: latencies[Math.ceil(latencies.length * 0.95) - 1]!,
    meanCostUsd: costs.reduce((total, cost) => total + cost, 0) / costs.length };
}

export function comparePerformanceRuns(baselineRuns: ExportedRun[], candidateRuns: ExportedRun[], limits: PerformanceThresholds) {
  const { identity: baselineIdentity, ...baseline } = summarize(baselineRuns);
  const { identity: candidateIdentity, ...candidate } = summarize(candidateRuns);
  if (baselineIdentity !== candidateIdentity || baseline.costSource !== candidate.costSource) {
    throw new Error("Performance comparison requires the same fixtures, model, effort, prompt, judge, and cost basis.");
  }
  const maxLatency = Math.min(limits.maxP95LatencyMs, baseline.p95LatencyMs * (1 + limits.maxLatencyIncreasePercent / 100));
  const maxCost = Math.min(limits.maxMeanCostUsd, baseline.meanCostUsd * (1 + limits.maxCostIncreasePercent / 100));
  const failures: string[] = [];
  if (Math.min(baseline.sampleCount, candidate.sampleCount) < limits.minimumSamples) failures.push("insufficient_samples");
  if (candidate.p95LatencyMs > maxLatency) failures.push("p95_latency_regressed");
  if (candidate.meanCostUsd > maxCost + 1e-9) failures.push("mean_cost_regressed");
  return { passed: failures.length === 0, baseline, candidate, limits: { p95LatencyMs: maxLatency, meanCostUsd: maxCost,
    minimumSamples: limits.minimumSamples }, failures };
}
