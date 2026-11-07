import type { CreateEvaluationRun } from "../ports/evaluation-repository.js";
import { evaluateRetrieval } from "./golden-set.js";
import {
  evaluateContextPrecision,
  reviewedPassageVersion,
} from "./context-precision.js";
import { evaluatePromptInjectionSuite } from "./prompt-injection-suite.js";
import {
  dashboardGoldenSet,
  dashboardPromptInjectionSuite,
} from "./default-evaluation-suites.js";
import {
  faithfulnessBenchmarkVersion,
  type FaithfulnessResult,
} from "./public-faithfulness.js";
import type { ReferenceRetrieval } from "./retrieve-reference-cases.js";

export type EvaluationMetrics = {
  retrieval: ReturnType<typeof evaluateRetrieval>;
  contextPrecision: ReturnType<typeof evaluateContextPrecision>;
  injection: ReturnType<typeof evaluatePromptInjectionSuite>;
};
export function assembleEvaluationReport(input: {
  tenantId: string;
  identity: {
    embeddingProvider: string;
    embeddingModel: string;
    chatProvider: string;
    chatModel: string;
  };
  cases: ReferenceRetrieval;
  faithfulness: FaithfulnessResult;
  metrics: EvaluationMetrics;
  durationMs: number;
  workflow?: {
    version: string;
    runId: string;
    costMicros: number;
    calls: number;
  };
}): CreateEvaluationRun {
  const { tenantId, identity, cases, metrics, durationMs, workflow } = input;
  const { value: faithfulness, ...details } = input.faithfulness;
  const { retrieval, contextPrecision, injection } = metrics;
  return {
    tenantId,
    datasetName: dashboardGoldenSet.name,
    datasetVersion: dashboardGoldenSet.version,
    commitSha: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null,
    ...identity,
    ...(cases.index
      ? {
          embeddingProvider: cases.index.provider,
          embeddingModel: cases.index.model,
        }
      : {}),
    totalCases: dashboardGoldenSet.cases.length,
    hitRate: retrieval.hitRate,
    meanReciprocalRank: retrieval.meanReciprocalRank,
    contextPrecision: contextPrecision.value,
    faithfulness,
    injectionPassRate:
      (injection.total - injection.failures.length) / injection.total,
    passed:
      retrieval.passed &&
      injection.passed &&
      cases.retrievalErrors.length === 0 &&
      (!workflow ||
        ((contextPrecision.value ?? 0) >= 0.7 &&
          !["calibration_failed", "incomplete"].includes(
            input.faithfulness.status,
          ) &&
          (faithfulness === null || faithfulness >= 0.8))),
    durationMs,
    failureDetails: {
      retrieval: retrieval.failedCases.map(({ id }) => ({ id })),
      retrievalErrors: cases.retrievalErrors,
      injection: injection.failures,
      ...(workflow
        ? {
            workflow: {
              ...workflow,
              reportVersion: "2.0",
              thresholds: { contextPrecision: 0.7, faithfulness: 0.8 },
              usage: "conservative_reservations",
            },
          }
        : {}),
      quality: {
        contextPrecision: {
          method: "reviewed-passage-ap",
          version: reviewedPassageVersion,
          scoredCases: contextPrecision.scoredCases,
          ...(cases.index?.version
            ? { embeddingIndexVersion: cases.index.version }
            : {}),
        },
        faithfulness: {
          method: "public-claim-evidence-judge",
          version: faithfulnessBenchmarkVersion,
          ...details,
        },
      },
    },
  };
}
