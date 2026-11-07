import type { RetrievedChunk } from "../../domain/document.js";
import { redactPii } from "../../domain/security/pii-redaction.js";
import { estimateChatCost, type ChatPricing } from "../policies/chat-cost.js";
import { createGroundedAnswerPrompt, formatUntrustedContext, groundedPromptVersion } from "../policies/grounded-answer-policy.js";
import { parseGroundedAnswer, validateGroundedAnswer } from "../policies/structured-answer.js";
import type { AnswerGenerator, ProviderTokenUsage } from "../ports/answer-generator.js";
import { normalizeEvidence, reviewedPassages } from "./context-precision.js";
import { dashboardGoldenSet } from "./default-evaluation-suites.js";
import type { EvaluationEffort } from "./evaluation-effort.js";
import { judgeCalibrationCases, judgeCalibrationVersion } from "./judge-calibration-cases.js";
import { benchmarkFingerprint } from "./replay-benchmark.js";

export const faithfulnessBenchmarkVersion = "1.0";
const maxAnswerChars = 2_500;
const evaluationTimeoutMs = 24_000;
const parallelCases = 2;
const datasetDigest = benchmarkFingerprint({ cases: dashboardGoldenSet.cases, reviewedPassages });

export interface FaithfulnessJudge {
  readonly model: string;
  assess(input: { answer: string; passages: readonly string[] }, signal: AbortSignal): Promise<Array<{ claim: string; evidence: string | null }>>;
}

export type EvaluationModel = ChatPricing & { provider: string; model: string; generator: Pick<AnswerGenerator, "generate">; maxOutputTokens: number };
type FaithfulnessStatus = "not_requested" | "unavailable" | "calibration_failed" | "incomplete" | "completed";
type MeasurementSource = "observed" | "estimated";

type CalibrationReport = {
  version: string;
  totalExamples: number;
  scoredExamples: number;
  expectedClaims: number;
  matchedClaims: number;
  falsePositives: number;
  falseNegatives: number;
  agreement: number | null;
  falsePositiveRate: number | null;
  falseNegativeRate: number | null;
};

type GenerationMeasurement = {
  caseId: string;
  score: number | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  tokenSource: MeasurementSource | null;
  costUsd: number | null;
  costSource: MeasurementSource | null;
};

export type FaithfulnessResult = {
  status: FaithfulnessStatus;
  value: number | null;
  scoredCases: number;
  totalCases: number;
  judgeModel: string | null;
  effort: EvaluationEffort | null;
  maxOutputTokens: number | null;
  promptVersion: string;
  datasetDigest: string;
  calibration: CalibrationReport | null;
  generationCases: GenerationMeasurement[];
};

export function unavailableFaithfulness(status: "not_requested" | "unavailable", judgeModel: string | null): FaithfulnessResult {
  return {
    status, value: null, scoredCases: 0, totalCases: dashboardGoldenSet.cases.length, judgeModel,
    effort: null, maxOutputTokens: null, promptVersion: groundedPromptVersion, datasetDigest, calibration: null, generationCases: []
  };
}

async function assessAnswer(judge: FaithfulnessJudge, answer: string, passages: readonly string[], signal: AbortSignal) {
  signal.throwIfAborted();
  const claims = await judge.assess({ answer, passages }, signal);
  const normalizedAnswer = normalizeEvidence(answer);
  const normalizedPassages = passages.map(normalizeEvidence);
  const unique = new Set<string>();
  if (claims.length === 0 || claims.length > 16) throw new Error("Invalid faithfulness claim count.");
  for (const { claim, evidence } of claims) {
    const normalized = normalizeEvidence(claim);
    if (!normalized || unique.has(normalized) || !normalizedAnswer.includes(normalized)) throw new Error("Invalid faithfulness claim.");
    unique.add(normalized);
    if (evidence !== null) {
      const quote = normalizeEvidence(evidence);
      if (quote.length < 12 || !normalizedPassages.some((passage) => passage.includes(quote))) throw new Error("Invalid faithfulness evidence.");
    }
  }
  return claims;
}

async function calibrate(judge: FaithfulnessJudge, signal: AbortSignal): Promise<CalibrationReport> {
  const assessed = await Promise.allSettled(judgeCalibrationCases.map(({ answer, passages }) => assessAnswer(judge, answer, passages, signal)));
  let scoredExamples = 0;
  let matchedClaims = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let matchedSupported = 0;
  let matchedUnsupported = 0;
  let expectedClaims = 0;
  for (const [index, { expected }] of judgeCalibrationCases.entries()) {
    expectedClaims += expected.length;
    const verdict = assessed[index];
    if (verdict?.status !== "fulfilled") continue;
    const claims = new Map(verdict.value.map(({ claim, evidence }) => [normalizeEvidence(claim).replace(/[.!?]$/u, ""), evidence]));
    let matched = 0;
    for (const { claim, support } of expected) {
      const evidence = claims.get(normalizeEvidence(claim));
      if (evidence === undefined) continue;
      matched += 1;
      if (support === null) {
        matchedUnsupported += 1;
        if (evidence !== null) falsePositives += 1;
      } else {
        matchedSupported += 1;
        if (evidence === null || !normalizeEvidence(evidence).includes(normalizeEvidence(support))) falseNegatives += 1;
      }
    }
    matchedClaims += matched;
    if (matched === expected.length && verdict.value.length === expected.length) scoredExamples += 1;
  }
  return {
    version: judgeCalibrationVersion, totalExamples: judgeCalibrationCases.length, scoredExamples, expectedClaims, matchedClaims,
    falsePositives, falseNegatives, agreement: matchedClaims ? 1 - (falsePositives + falseNegatives) / matchedClaims : null,
    falsePositiveRate: matchedUnsupported ? falsePositives / matchedUnsupported : null,
    falseNegativeRate: matchedSupported ? falseNegatives / matchedSupported : null
  };
}

async function scorePublicCase(item: typeof dashboardGoldenSet.cases[number], model: EvaluationModel, judge: FaithfulnessJudge, signal: AbortSignal) {
  signal.throwIfAborted();
  const reference = reviewedPassages[item.id as keyof typeof reviewedPassages];
  if (!reference) throw new Error("Missing public benchmark passage.");
  const fixture: RetrievedChunk = {
    chunkId: item.id, documentId: "public-reference", ordinal: 0, content: reference.content,
    source: "public-reference", title: null, score: 1, security: { promptInjectionRisk: "low", signals: [] }
  };
  const context = formatUntrustedContext([fixture], 2_000);
  const started = performance.now();
  let observed: ProviderTokenUsage | undefined;
  const rawAnswer = await model.generator.generate(item.question, context.text, signal, (usage) => { observed = usage; }).catch(() => null);
  const latencyMs = Math.round(performance.now() - started);
  const prompt = createGroundedAnswerPrompt(item.question, context.text);
  const inputTokens = observed?.inputTokens ?? (rawAnswer === null ? null : Math.ceil((prompt.system.length + prompt.user.length) / 4));
  const outputTokens = observed?.outputTokens ?? (rawAnswer === null ? null : Math.ceil(rawAnswer.length / 4));
  const costUsd = observed?.costUsd ?? (inputTokens === null || outputTokens === null ? null : estimateChatCost(model, inputTokens, outputTokens));
  const result: GenerationMeasurement = {
    caseId: item.id, latencyMs, inputTokens, outputTokens, costUsd, score: null,
    tokenSource: observed ? "observed" : inputTokens === null ? null : "estimated",
    costSource: observed?.costUsd !== undefined ? "observed" : costUsd === null ? null : "estimated"
  };
  if (rawAnswer === null || signal.aborted) return result;
  try {
    const answer = validateGroundedAnswer(parseGroundedAnswer(rawAnswer), new Set(context.sourcesByReference.keys()));
    if (!answer.structured || answer.refusalReason || answer.answer.length > maxAnswerChars) return result;
    const claims = await assessAnswer(judge, redactPii(answer.answer).text, [reference.content], signal);
    return { ...result, score: claims.filter(({ evidence }) => evidence !== null).length / claims.length };
  } catch { return result; }
}

/** Only bundled public cases enter either generation or the judge. */
export async function evaluatePublicFaithfulness(model: EvaluationModel, judge: FaithfulnessJudge, effort: EvaluationEffort): Promise<FaithfulnessResult> {
  const signal = AbortSignal.timeout(evaluationTimeoutMs);
  const cases = dashboardGoldenSet.cases;
  const result: FaithfulnessResult = {
    status: "calibration_failed", value: null, scoredCases: 0, totalCases: cases.length, judgeModel: judge.model,
    effort, maxOutputTokens: model.maxOutputTokens, promptVersion: groundedPromptVersion, datasetDigest,
    calibration: await calibrate(judge, signal), generationCases: []
  };
  if (result.calibration?.scoredExamples !== judgeCalibrationCases.length || result.calibration.agreement !== 1) return result;

  let total = 0;
  for (let index = 0; index < cases.length && !signal.aborted; index += parallelCases) {
    const scores = await Promise.allSettled(cases.slice(index, index + parallelCases).map((item) => scorePublicCase(item, model, judge, signal)));
    for (const score of scores) {
      if (score.status !== "fulfilled") continue;
      result.generationCases.push(score.value);
      if (score.value.score === null) continue;
      result.scoredCases += 1;
      total += score.value.score;
    }
  }
  if (result.scoredCases !== result.totalCases) return { ...result, status: "incomplete" };
  return { ...result, status: "completed", value: total / result.totalCases };
}
