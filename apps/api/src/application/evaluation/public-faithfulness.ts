import { WorkflowGuardError } from "../workflows/types.js";
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

export type CalibrationReport = {
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

export type GenerationMeasurement = {
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

export async function calibrate(judge: FaithfulnessJudge, signal: AbortSignal): Promise<CalibrationReport> {
  const assessed = await Promise.allSettled(judgeCalibrationCases.map(({ answer, passages }) => assessAnswer(judge, answer, passages, signal)));
  signal.throwIfAborted();
  for (const outcome of assessed) if (outcome.status === "rejected" && outcome.reason instanceof WorkflowGuardError) throw outcome.reason;
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

export type PublicGeneratedCase = {caseId:string;rawAnswer:string|null;measurement:GenerationMeasurement};

export async function generatePublicCase(item:typeof dashboardGoldenSet.cases[number],model:EvaluationModel,signal:AbortSignal):Promise<PublicGeneratedCase> {
  signal.throwIfAborted();
  const reference=reviewedPassages[item.id as keyof typeof reviewedPassages];
  if(!reference)throw new Error("Missing public benchmark passage.");
  const fixture:RetrievedChunk={chunkId:item.id,documentId:"public-reference",ordinal:0,content:reference.content,source:"public-reference",title:null,score:1,security:{promptInjectionRisk:"low",signals:[]}};
  const context=formatUntrustedContext([fixture],2_000);
  const started=performance.now();let observed:ProviderTokenUsage|undefined;
  const rawAnswer=await model.generator.generate(item.question,context.text,signal,(usage)=>{observed=usage;}).catch((error:unknown)=>{signal.throwIfAborted();if(error instanceof WorkflowGuardError)throw error;return null;});
  signal.throwIfAborted();
  const latencyMs=Math.round(performance.now()-started),prompt=createGroundedAnswerPrompt(item.question,context.text);
  const inputTokens=observed?.inputTokens??(rawAnswer===null?null:Math.ceil((prompt.system.length+prompt.user.length)/4));
  const outputTokens=observed?.outputTokens??(rawAnswer===null?null:Math.ceil(rawAnswer.length/4));
  const costUsd=observed?.costUsd??(inputTokens===null||outputTokens===null?null:estimateChatCost(model,inputTokens,outputTokens));
  return{caseId:item.id,rawAnswer,measurement:{caseId:item.id,latencyMs,inputTokens,outputTokens,costUsd,score:null,
    tokenSource:observed?"observed":inputTokens===null?null:"estimated",costSource:observed?.costUsd!==undefined?"observed":costUsd===null?null:"estimated"}};
}

export async function scoreGeneratedPublicCase(generated:PublicGeneratedCase,judge:FaithfulnessJudge,signal:AbortSignal):Promise<GenerationMeasurement> {
  signal.throwIfAborted();const {measurement,rawAnswer,caseId}=generated;
  if(rawAnswer===null)return measurement;
  const reference=reviewedPassages[caseId as keyof typeof reviewedPassages];
  if(!reference)return measurement;
  try{
    const answer=validateGroundedAnswer(parseGroundedAnswer(rawAnswer),new Set(['S1']));
    if(!answer.structured||answer.refusalReason||answer.answer.length>maxAnswerChars)return measurement;
    const claims=await assessAnswer(judge,redactPii(answer.answer).text,[reference.content],signal);
    return{...measurement,score:claims.filter(({evidence})=>evidence!==null).length/claims.length};
  }catch(error){signal.throwIfAborted();if(error instanceof WorkflowGuardError)throw error;return measurement;}
}

export function publicFaithfulnessReport(model:EvaluationModel,judge:FaithfulnessJudge,effort:EvaluationEffort,calibration:CalibrationReport,measurements:GenerationMeasurement[]):FaithfulnessResult {
  const result:FaithfulnessResult={status:'calibration_failed',value:null,scoredCases:0,totalCases:dashboardGoldenSet.cases.length,judgeModel:judge.model,
    effort,maxOutputTokens:model.maxOutputTokens,promptVersion:groundedPromptVersion,datasetDigest,calibration,generationCases:measurements};
  if(calibration.scoredExamples!==judgeCalibrationCases.length||calibration.agreement!==1)return result;
  const scored=measurements.filter((item)=>item.score!==null);
  if(scored.length!==result.totalCases)return{...result,status:'incomplete',scoredCases:scored.length};
  return{...result,status:'completed',scoredCases:scored.length,value:scored.reduce((sum,item)=>sum+item.score!,0)/result.totalCases};
}

/** Only bundled public cases enter generation or the judge; callers may provide a cancellation signal. */
export async function evaluatePublicFaithfulness(model:EvaluationModel,judge:FaithfulnessJudge,effort:EvaluationEffort,parent?:AbortSignal):Promise<FaithfulnessResult> {
  const signal=parent?AbortSignal.any([parent,AbortSignal.timeout(evaluationTimeoutMs)]):AbortSignal.timeout(evaluationTimeoutMs);
  const calibration=await calibrate(judge,signal);
  if(calibration.scoredExamples!==judgeCalibrationCases.length||calibration.agreement!==1)return publicFaithfulnessReport(model,judge,effort,calibration,[]);
  const measurements:GenerationMeasurement[]=[];
  for(let index=0;index<dashboardGoldenSet.cases.length;index+=parallelCases){
    signal.throwIfAborted();
    const outcomes=await Promise.allSettled(dashboardGoldenSet.cases.slice(index,index+parallelCases).map(async(item)=>scoreGeneratedPublicCase(await generatePublicCase(item,model,signal),judge,signal)));
    for(const outcome of outcomes)if(outcome.status==='fulfilled')measurements.push(outcome.value);
  }
  return publicFaithfulnessReport(model,judge,effort,calibration,measurements);
}
