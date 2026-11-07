import { z } from "zod";
import type { RetrievedChunk } from "../../../knowledge/index.js";

const goldenCaseSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  expectedSources: z.array(z.string().min(1)).min(1),
  note: z.string().min(1).optional()
});

export const goldenSetSchema = z.object({
  version: z.string().min(1),
  name: z.string().min(1),
  thresholds: z.object({
    hitRate: z.number().min(0).max(1).default(0.8),
    meanReciprocalRank: z.number().min(0).max(1).default(0.7)
  }).default({ hitRate: 0.8, meanReciprocalRank: 0.7 }),
  cases: z.array(goldenCaseSchema).min(1)
});

export type GoldenSet = z.infer<typeof goldenSetSchema>;
export type GoldenCase = z.infer<typeof goldenCaseSchema>;

export type RetrievalEvaluation = {
  total: number;
  hits: number;
  hitRate: number;
  meanReciprocalRank: number;
  passed: boolean;
  failedCases: Array<{ id: string; question: string; returnedSources: string[] }>;
};

export function evaluateRetrieval(
  goldenSet: GoldenSet,
  resultsByCaseId: Map<string, RetrievedChunk[]>
): RetrievalEvaluation {
  let hits = 0;
  let reciprocalRankTotal = 0;
  const failedCases: RetrievalEvaluation["failedCases"] = [];

  for (const item of goldenSet.cases) {
    const results = resultsByCaseId.get(item.id) ?? [];
    const rank = results.findIndex((result) => item.expectedSources.includes(result.source));
    if (rank >= 0) {
      hits += 1;
      reciprocalRankTotal += 1 / (rank + 1);
      continue;
    }
    failedCases.push({
      id: item.id,
      question: item.question,
      returnedSources: [...new Set(results.map((result) => result.source))]
    });
  }

  const total = goldenSet.cases.length;
  const hitRate = hits / total;
  const meanReciprocalRank = reciprocalRankTotal / total;
  return {
    total,
    hits,
    hitRate,
    meanReciprocalRank,
    passed: hitRate >= goldenSet.thresholds.hitRate && meanReciprocalRank >= goldenSet.thresholds.meanReciprocalRank,
    failedCases
  };
}
