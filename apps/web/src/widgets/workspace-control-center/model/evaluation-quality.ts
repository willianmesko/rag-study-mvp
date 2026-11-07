import { z } from "zod";
import type { EvaluationRun } from "../../../shared/api/rag-api";

export const evaluationEfforts = ["compact", "standard", "extended"] as const;
export type EvaluationEffort = typeof evaluationEfforts[number];
export const effortLabels: Record<EvaluationEffort, [string, string]> = {
  compact: ["Compact", "Compacto"], standard: ["Standard", "Padrão"], extended: ["Extended", "Estendido"]
};

const generationCase = z.object({
  caseId: z.string(), score: z.number().min(0).max(1).nullable(), latencyMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable().optional(), outputTokens: z.number().int().nonnegative().nullable().optional(),
  tokenSource: z.enum(["observed", "estimated"]).nullable().optional(),
  costUsd: z.number().nonnegative().nullable(), costSource: z.enum(["observed", "estimated"]).nullable()
});
const qualityDetailsSchema = z.object({
  contextPrecision: z.object({ method: z.literal("reviewed-passage-ap"), version: z.string(), scoredCases: z.number() }),
  faithfulness: z.object({
    method: z.literal("public-claim-evidence-judge"), version: z.string(),
    status: z.enum(["not_requested", "unavailable", "calibration_failed", "incomplete", "completed"]),
    judgeModel: z.string().nullable(), scoredCases: z.number(), totalCases: z.number(),
    effort: z.enum(evaluationEfforts).nullable().optional(), maxOutputTokens: z.number().int().positive().nullable().optional(),
    promptVersion: z.string().optional(), datasetDigest: z.string().optional(), generationCases: z.array(generationCase).optional(),
    calibration: z.object({
      version: z.string(), expectedClaims: z.number(), matchedClaims: z.number(),
      falsePositives: z.number().optional(), falseNegatives: z.number().optional(),
      agreement: z.number().nullable(), falsePositiveRate: z.number().nullable(), falseNegativeRate: z.number().nullable()
    }).nullable().optional()
  })
});

export function readEvaluationQuality(run?: EvaluationRun) {
  return qualityDetailsSchema.safeParse(run?.failureDetails.quality).data;
}

function completedEffort(run: EvaluationRun) {
  const quality = readEvaluationQuality(run)?.faithfulness;
  const cases = quality?.generationCases;
  if (run.faithfulness === null || quality?.status !== "completed" || !quality.effort || !quality.maxOutputTokens
    || !quality.promptVersion || !quality.datasetDigest || !quality.calibration || !cases?.length
    || cases.length !== quality.totalCases || cases.some(({ score }) => score === null)) return undefined;
  return { ...quality, effort: quality.effort, maxOutputTokens: quality.maxOutputTokens, calibration: quality.calibration, generationCases: cases };
}

export function evaluationMeasurementExport(run: EvaluationRun) {
  const faithfulness = completedEffort(run);
  if (!faithfulness) return undefined;
  return {
    chatProvider: run.chatProvider, chatModel: run.chatModel, datasetVersion: run.datasetVersion,
    commitSha: run.commitSha, faithfulness: run.faithfulness, createdAt: run.createdAt,
    failureDetails: { quality: { faithfulness } }
  };
}

export function compareRecordedEfforts(runs: EvaluationRun[]) {
  const candidates = runs.flatMap((run) => {
    const quality = completedEffort(run);
    if (!quality) return [];
    const cases = quality.generationCases;
    const costSource = cases[0]?.costSource;
    return [{ effort: quality.effort, maxOutputTokens: quality.maxOutputTokens, model: run.chatModel,
      identity: JSON.stringify([run.chatProvider, run.chatModel, run.commitSha, quality.version, quality.datasetDigest,
        quality.promptVersion, quality.judgeModel, quality.calibration.version, cases.map(({ caseId }) => caseId).sort()]),
      faithfulness: run.faithfulness, meanLatencyMs: cases.reduce((sum, { latencyMs }) => sum + latencyMs, 0) / cases.length,
      costSource, meanCostUsd: costSource && cases.every((item) => item.costUsd !== null && item.costSource === costSource)
        ? cases.reduce((sum, { costUsd }) => sum + (costUsd ?? 0), 0) / cases.length : null }];
  });
  for (const [index, latest] of candidates.entries()) {
    const earlier = candidates.slice(index + 1).find((item) => item.identity === latest.identity && item.effort !== latest.effort && item.maxOutputTokens !== latest.maxOutputTokens);
    if (earlier) return [earlier, latest] as const;
  }
  return undefined;
}
