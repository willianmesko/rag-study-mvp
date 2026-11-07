import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { RetrievedChunk } from "../../domain/document.js";
import { contextPrecisionAtK, normalizeEvidence, reviewedPassages } from "../evaluation/context-precision.js";
import { dashboardGoldenSet } from "../evaluation/default-evaluation-suites.js";
import type { EvaluationModel, FaithfulnessJudge } from "../evaluation/public-faithfulness.js";
import type { EvaluationRepository, EvaluationRun } from "../ports/evaluation-repository.js";
import { EvaluationRunError, RunEvaluationUseCase } from "./run-evaluation.js";

function stored(input: Omit<EvaluationRun, "id" | "createdAt">): EvaluationRun {
  return { ...input, id: "run-1", createdAt: new Date("2026-01-01T00:00:00Z") };
}

const repository: EvaluationRepository = { create: async (input) => stored(input), list: async () => [] };
const models = { embeddingProvider: "test", embeddingModel: "test-embedding", chatProvider: "test", chatModel: "test-chat" };

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
  const publicReference = await readFile(new URL("../../../../../examples/rag-fundamentals.md", import.meta.url), "utf8");
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
    if (input.answer.startsWith("The archive")) return [
      { claim: "The archive opens on Monday.", evidence: "The archive opens on Monday." },
      { claim: "Visitors must bring a passport.", evidence: null }
    ];
    return [{ claim: input.answer.split(". ")[0]!, evidence: input.answer.split(". ")[0]! }, { claim: unsupported, evidence: null }];
  } };
  const model: EvaluationModel = { provider: "openrouter", model: "fixture-answer", generator: { async generate(question, context) {
    assert.doesNotMatch(context, /private/);
    return JSON.stringify({ answer: `${answerFor(question)}. ${unsupported}`, citedChunkIds: ["S1"] });
  } } };
  const useCase = new RunEvaluationUseCase({
    execute: async ({ query }) => [chunk("golden/rag-fundamentals", answerFor(query)), chunk("private", "Private user text")]
  }, repository, models, { judge, resolveModel: (id) => id === "approved" ? model : undefined });

  assert.equal((await useCase.execute({ tenantId: "tenant-1" })).faithfulness, null);
  assert.equal(judgeInputs.length, 0);
  const result = await useCase.execute({ tenantId: "tenant-1", includeFaithfulness: true, modelId: "approved" });
  assert.equal(result.faithfulness, 0.5);
  assert.equal(result.contextPrecision, 1);
  assert.equal(result.chatModel, "fixture-answer");
  assert.equal(judgeInputs.length, dashboardGoldenSet.cases.length + 1);
  assert.doesNotMatch(JSON.stringify(judgeInputs), /private/);
  assert.doesNotMatch(JSON.stringify(result.failureDetails), /perfect results/);
  await assert.rejects(useCase.execute({ tenantId: "tenant-1", includeFaithfulness: true, modelId: "arbitrary" }), { code: "model_unavailable" });
});

test("failed calibration leaves faithfulness unavailable and never calls the answer model", async () => {
  let generations = 0;
  const model: EvaluationModel = { provider: "fixture", model: "fixture", generator: { async generate() { generations++; return ""; } } };
  const judge: FaithfulnessJudge = { model: "uncalibrated", async assess() {
    return [{ claim: "Visitors must bring a passport.", evidence: "The archive opens on Monday." }];
  } };
  const useCase = new RunEvaluationUseCase({ execute: async ({ query }) => [chunk("golden/rag-fundamentals", answerFor(query))] }, repository, models,
    { judge, resolveModel: () => model });
  const result = await useCase.execute({ tenantId: "tenant-1", includeFaithfulness: true });
  assert.equal(generations, 0);
  assert.equal(result.faithfulness, null);
  assert.equal(result.passed, true);
  assert.match(JSON.stringify(result.failureDetails), /calibration_failed/);
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
