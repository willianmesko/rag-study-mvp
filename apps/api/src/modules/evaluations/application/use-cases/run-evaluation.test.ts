import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { RetrievedChunk } from "../../../knowledge/domain/document.js";
import { contextPrecisionAtK, normalizeEvidence, reviewedPassages } from "../evaluation/context-precision.js";
import { dashboardGoldenSet } from "../evaluation/default-evaluation-suites.js";
import { judgeCalibrationCases } from "../evaluation/judge-calibration-cases.js";
import type { EvaluationModel, FaithfulnessJudge, FaithfulnessResult } from "../evaluation/public-faithfulness.js";
import type { EvaluationRepository, EvaluationRun } from "../ports/evaluation-repository.js";
import { EvaluationRunError, RunEvaluationUseCase } from "./run-evaluation.js";

function stored(input: Omit<EvaluationRun, "id" | "createdAt">): EvaluationRun {
  return { ...input, id: "run-1", createdAt: new Date("2026-01-01T00:00:00Z") };
}

const repository: EvaluationRepository = { create: async (input) => stored(input), list: async () => [] };
const models = { embeddingProvider: "test", embeddingModel: "test-embedding", chatProvider: "test", chatModel: "test-chat" };
const prices = { inputCostPer1kUsd: 0.0004, outputCostPer1kUsd: 0.0016 };

function faithfulnessDetails(run: EvaluationRun) {
  return (run.failureDetails.quality as { faithfulness: Omit<FaithfulnessResult, "value"> }).faithfulness;
}

function chunk(source: string, content: string, chunkId = source, promptInjectionRisk: "low" | "high" = "low"): RetrievedChunk {
  return { chunkId, documentId: "document-1", ordinal: 0, content, source, title: null, score: 0.8, security: { promptInjectionRisk, signals: [] } };
}

function answerFor(question: string) {
  const item = dashboardGoldenSet.cases.find((entry) => entry.question === question);
  assert.ok(item);
  return reviewedPassages[item.id as keyof typeof reviewedPassages].anchor;
}

test("evaluation run persists retrieval and injection metrics", async () => {
  const result = await new RunEvaluationUseCase({
    execute: async ({ query }) => [chunk("golden/rag-fundamentals", answerFor(query))]
  }, repository, models).execute({ tenantId: "tenant-1" });

  assert.equal(result.hitRate, 1);
  assert.equal(result.meanReciprocalRank, 1);
  assert.equal(result.injectionPassRate, 1);
  assert.equal(result.contextPrecision, 1);
  assert.equal(result.faithfulness, null);
  assert.equal(result.passed, true);
  assert.equal(result.datasetVersion, "1.0");
});

test("evaluation history does not persist questions, private source names, or provider errors", async () => {
  const result = await new RunEvaluationUseCase({ execute: async ({ query }) => {
    if (query === "What does RAG mean?") throw new Error("Private upstream diagnostic");
    return [chunk("private/identifiable-source", "Private unreviewed content")];
  } }, repository, models).execute({ tenantId: "tenant-1" });

  const serialized = JSON.stringify(result.failureDetails);
  assert.equal(serialized.includes("What does RAG mean?"), false);
  assert.doesNotMatch(serialized, /private/i);
  assert.equal(result.passed, false);
  assert.equal(result.contextPrecision, null);
});

test("ranked context precision checks actual reviewed text rather than source names alone", async () => {
  assert.ok(Math.abs(contextPrecisionAtK([true, false, true]) - 5 / 6) < 1e-10);
  assert.equal(contextPrecisionAtK([false, false]), 0);
  const result = await new RunEvaluationUseCase({ execute: async ({ query }) => [
    chunk("golden/rag-fundamentals", answerFor(query), "unsafe", "high"),
    chunk("golden/rag-fundamentals", "An unrelated passage with the expected source name.", "distractor"),
    chunk("golden/rag-fundamentals", answerFor(query), "relevant")
  ] }, repository, models).execute({ tenantId: "tenant-1" });
  assert.equal(result.hitRate, 1);
  assert.equal(result.meanReciprocalRank, 1);
  assert.equal(result.contextPrecision, 0.5);
});

test("reviewed excerpts match the versioned public reference document", async () => {
  const publicReference = await readFile(new URL("../../../../../../../examples/rag-fundamentals.md", import.meta.url), "utf8");
  const normalized = normalizeEvidence(publicReference);
  for (const item of dashboardGoldenSet.cases) {
    const reference = reviewedPassages[item.id as keyof typeof reviewedPassages];
    assert.ok(reference);
    assert.ok(normalized.includes(normalizeEvidence(reference.content)));
    assert.ok(normalizeEvidence(reference.content).includes(normalizeEvidence(reference.anchor)));
  }
});

test("the opt-in calibrated judge only evaluates bundled public evidence with the selected answer model", async () => {
  const unsupported = "The service guarantees perfect results.";
  const judgeInputs: Array<Parameters<FaithfulnessJudge["assess"]>[0]> = [];
  const judge: FaithfulnessJudge = { model: "fixture-judge", async assess(input, signal) {
    assert.ok(!signal.aborted);
    judgeInputs.push(input);
    const control = judgeCalibrationCases.find(({ answer }) => answer === input.answer);
    if (control) return control.expected.map(({ claim, support }) => ({ claim, evidence: support }));
    return [{ claim: input.answer.split(". ")[0]!, evidence: input.answer.split(". ")[0]! }, { claim: unsupported, evidence: null }];
  } };
  const prompts: Array<{ question: string; context: string }> = [];
  const model: EvaluationModel = { provider: "openrouter", model: "fixture-answer", maxOutputTokens: 320, ...prices, generator: { async generate(question, context, _signal, observe) {
    assert.doesNotMatch(context, /private/);
    prompts.push({ question, context });
    if (question === "What does RAG mean?") observe?.({ inputTokens: 330, outputTokens: 43, costUsd: 0.00017 });
    return JSON.stringify({ answer: `${answerFor(question)}. ${unsupported}`, citedChunkIds: ["S1"] });
  } } };
  const useCase = new RunEvaluationUseCase({
    execute: async ({ query }) => [chunk("golden/rag-fundamentals", answerFor(query)), chunk("private", "Private user text")]
  }, repository, models, { judge, resolveModel: (tenant, id, maxOutputTokens) => tenant === "tenant-1" && id === "approved" ? { ...model, maxOutputTokens } : undefined });

  assert.equal((await useCase.execute({ tenantId: "tenant-1" })).faithfulness, null);
  assert.equal(judgeInputs.length, 0);
  const result = await useCase.execute({ tenantId: "tenant-1", includeFaithfulness: true, modelId: "approved", effort: "compact" });
  const details = faithfulnessDetails(result);
  assert.equal(result.faithfulness, 0.5);
  assert.equal(result.contextPrecision, 1);
  assert.equal(result.chatModel, "fixture-answer");
  assert.equal(judgeInputs.length, dashboardGoldenSet.cases.length + judgeCalibrationCases.length);
  assert.equal(details.effort, "compact");
  assert.equal(details.maxOutputTokens, 160);
  assert.equal(details.calibration?.agreement, 1);
  assert.equal(details.calibration?.falsePositiveRate, 0);
  assert.equal(details.calibration?.falseNegativeRate, 0);
  assert.equal(details.calibration?.matchedClaims, 6);
  const [observed, estimated] = details.generationCases;
  assert.equal(observed?.caseId, "rag-definition");
  assert.equal(observed?.inputTokens, 330);
  assert.equal(observed?.outputTokens, 43);
  assert.equal(observed?.tokenSource, "observed");
  assert.equal(observed?.costSource, "observed");
  assert.equal(observed?.costUsd, 0.00017);
  assert.equal(estimated?.tokenSource, "estimated");
  assert.equal(estimated?.costSource, "estimated");
  assert.ok(estimated?.costUsd && estimated.costUsd > 0);
  assert.doesNotMatch(JSON.stringify(judgeInputs), /private/);
  assert.doesNotMatch(JSON.stringify(result.failureDetails), /perfect results/);
  const extended = await useCase.execute({ tenantId: "tenant-1", includeFaithfulness: true, modelId: "approved", effort: "extended" });
  assert.equal(faithfulnessDetails(extended).maxOutputTokens, 500);
  assert.equal(faithfulnessDetails(extended).datasetDigest, details.datasetDigest);
  assert.equal(faithfulnessDetails(extended).promptVersion, details.promptVersion);
  assert.deepEqual(prompts.slice(0, 4), prompts.slice(4));
  await assert.rejects(useCase.execute({ tenantId: "tenant-1", includeFaithfulness: true, modelId: "arbitrary" }), { code: "model_unavailable" });
});

test("failed calibration leaves faithfulness unavailable and never calls the answer model", async () => {
  let generations = 0;
  const model: EvaluationModel = { provider: "fixture", model: "fixture", maxOutputTokens: 320, ...prices, generator: { async generate() { generations++; return ""; } } };
  const judge: FaithfulnessJudge = { model: "uncalibrated", async assess(input) {
    const control = judgeCalibrationCases.find(({ answer }) => answer === input.answer);
    assert.ok(control);
    return control.expected.map(({ claim, support }) => ({
      claim, evidence: claim === "O envio é gratuito" ? input.passages[0]! : claim === "The archive opens on Monday" ? null : support
    }));
  } };
  const useCase = new RunEvaluationUseCase({ execute: async ({ query }) => [chunk("golden/rag-fundamentals", answerFor(query))] }, repository, models,
    { judge, resolveModel: () => model });
  const result = await useCase.execute({ tenantId: "tenant-1", includeFaithfulness: true });
  assert.equal(generations, 0);
  assert.equal(result.faithfulness, null);
  assert.equal(result.passed, true);
  const details = faithfulnessDetails(result);
  assert.equal(details.status, "calibration_failed");
  assert.equal(details.calibration?.falsePositives, 1);
  assert.equal(details.calibration?.falseNegatives, 1);
  assert.equal(details.calibration?.matchedClaims, 6);
});

test("a second run for the same workspace cannot start while an evaluation is in progress", async () => {
  let finish!: (value: RetrievedChunk[]) => void;
  const pending = new Promise<RetrievedChunk[]>((resolve) => { finish = resolve; });
  const useCase = new RunEvaluationUseCase({ execute: async () => pending }, repository, models);
  const first = useCase.execute({ tenantId: "tenant-1" });
  await assert.rejects(useCase.execute({ tenantId: "tenant-1" }), (error: unknown) => error instanceof EvaluationRunError && error.code === "evaluation_in_progress");
  finish([]);
  await first;
  await useCase.execute({ tenantId: "tenant-1" });
});

test("a workspace index cutover invalidates retrieval scores rather than combining index versions", async () => {
  let reads = 0;
  const useCase = new RunEvaluationUseCase({
    execute: async ({ query }) => [chunk("golden/rag-fundamentals", answerFor(query))]
  }, repository, models, undefined, async (tenantId) => {
    assert.equal(tenantId, "tenant-1");
    return { provider: "openrouter", model: "fixture-embedding", version: `index-${++reads}` };
  });
  const result = await useCase.execute({ tenantId: "tenant-1" });
  assert.equal(result.embeddingModel, "fixture-embedding");
  assert.equal(result.contextPrecision, null);
  assert.equal(result.passed, false);
  assert.match(JSON.stringify(result.failureDetails), /embedding_index_changed/);
});

test("missing reference material blocks paid judging and retrieval before an evaluation is created", async (t) => {
  const retrieve = t.mock.fn(async () => []);
  const create = t.mock.fn(async (input: Omit<EvaluationRun, "id" | "createdAt">) => stored(input));
  const resolveModel = t.mock.fn(async () => undefined);
  const judge: FaithfulnessJudge = { model: "fixture", assess: async () => { throw new Error("Judge must not run."); } };
  const useCase = new RunEvaluationUseCase({ execute: retrieve }, { create, list: async () => [] }, models,
    { judge, resolveModel }, undefined, async (tenant) => { assert.equal(tenant, "tenant-1"); return false; });
  await assert.rejects(useCase.execute({ tenantId: "tenant-1", includeFaithfulness: true }), { code: "evaluation_reference_missing" });
  assert.equal(retrieve.mock.callCount(), 0);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(resolveModel.mock.callCount(), 0);
});
