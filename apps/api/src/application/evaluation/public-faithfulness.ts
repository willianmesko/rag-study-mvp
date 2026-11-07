import type { RetrievedChunk } from "../../domain/document.js";
import { redactPii } from "../../domain/security/pii-redaction.js";
import { formatUntrustedContext } from "../policies/grounded-answer-policy.js";
import { parseGroundedAnswer, validateGroundedAnswer } from "../policies/structured-answer.js";
import type { AnswerGenerator } from "../ports/answer-generator.js";
import { normalizeEvidence, reviewedPassages } from "./context-precision.js";
import { dashboardGoldenSet } from "./default-evaluation-suites.js";

export const faithfulnessBenchmarkVersion = "1.0";
const maxAnswerChars = 2_500;
const evaluationTimeoutMs = 24_000;
const parallelCases = 2;

export interface FaithfulnessJudge {
  readonly model: string;
  assess(input: { answer: string; passages: readonly string[] }, signal: AbortSignal): Promise<Array<{ claim: string; evidence: string | null }>>;
}

export type EvaluationModel = { provider: string; model: string; generator: Pick<AnswerGenerator, "generate"> };
type FaithfulnessStatus = "not_requested" | "unavailable" | "calibration_failed" | "incomplete" | "completed";

export type FaithfulnessResult = {
  status: FaithfulnessStatus;
  value: number | null;
  scoredCases: number;
  totalCases: number;
  judgeModel: string | null;
};

export function unavailableFaithfulness(status: "not_requested" | "unavailable", judgeModel: string | null): FaithfulnessResult {
  return { status, value: null, scoredCases: 0, totalCases: dashboardGoldenSet.cases.length, judgeModel };
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

async function calibrate(judge: FaithfulnessJudge, signal: AbortSignal): Promise<boolean> {
  const answer = "The archive opens on Monday. Visitors must bring a passport.";
  const claims = await assessAnswer(judge, answer, ["The archive opens on Monday. Its reading room is on the first floor."], signal);
  return claims.length === 2
    && claims.some(({ claim, evidence }) => /opens on monday/i.test(claim) && evidence !== null && /opens on monday/i.test(evidence))
    && claims.some(({ claim, evidence }) => /bring a passport/i.test(claim) && evidence === null);
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
  const rawAnswer = await model.generator.generate(item.question, context.text, signal);
  signal.throwIfAborted();
  const answer = validateGroundedAnswer(parseGroundedAnswer(rawAnswer), new Set(context.sourcesByReference.keys()));
  if (!answer.structured || answer.refusalReason || answer.answer.length > maxAnswerChars) throw new Error("Public answer is not eligible for scoring.");

  const claims = await assessAnswer(judge, redactPii(answer.answer).text, [reference.content], signal);
  return claims.filter(({ evidence }) => evidence !== null).length / claims.length;
}

/** Only bundled public cases enter either generation or the judge. */
export async function evaluatePublicFaithfulness(model: EvaluationModel, judge: FaithfulnessJudge): Promise<FaithfulnessResult> {
  const signal = AbortSignal.timeout(evaluationTimeoutMs);
  const cases = dashboardGoldenSet.cases;
  const result: FaithfulnessResult = {
    status: "calibration_failed", value: null, scoredCases: 0, totalCases: cases.length, judgeModel: judge.model
  };
  if (!await calibrate(judge, signal).catch(() => false)) return result;

  let total = 0;
  for (let index = 0; index < cases.length && !signal.aborted; index += parallelCases) {
    const scores = await Promise.allSettled(cases.slice(index, index + parallelCases).map((item) => scorePublicCase(item, model, judge, signal)));
    for (const score of scores) {
      if (score.status !== "fulfilled") continue;
      result.scoredCases += 1;
      total += score.value;
    }
  }
  if (result.scoredCases !== result.totalCases) return { ...result, status: "incomplete" };
  return { ...result, status: "completed", value: total / result.totalCases };
}
