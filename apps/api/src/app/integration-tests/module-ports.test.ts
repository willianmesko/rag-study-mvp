import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createChatRuntime } from "../../modules/chat/chat.module.js";
import type { AnswerWorkflowOptions, GroundedQuestionWorkflow } from "../../modules/chat/application/ports/answer-workflow-factory.js";
import type { ChatRuntimeOptions } from "../../modules/chat/application/ports/chat-runtime-options.js";
import { createEvaluationServices } from "../../modules/evaluations/evaluations.module.js";
import type { EvaluationRun, EvaluationRepository } from "../../modules/evaluations/application/ports/evaluation-repository.js";
import { createIngestionWorkflow } from "../../modules/ingestion/ingestion.module.js";
import type { IngestionJob } from "../../modules/ingestion/application/ports/ingestion-job-repository.js";
import type { IngestionWorkflowOptions } from "../../modules/ingestion/application/ports/ingestion-workflow.js";
import { createWorkspaceWorkflowServices } from "../../modules/workflows/workflows.module.js";
import type { WorkflowAdmission, WorkflowHandler, WorkflowKind, WorkflowSnapshot, WorkflowRepository, WorkflowEngine } from "../../platform/workflows/types.js";
import { WorkflowGuardError } from "../../platform/workflows/types.js";

const tenantId = "20000000-0000-4000-8000-000000000001";
const actorId = "20000000-0000-4000-8000-000000000002";
const jobId = "20000000-0000-4000-8000-000000000003";
const options: ChatRuntimeOptions = {
  defaultModel: { provider: "ollama", model: "fixture-chat", inputCostPer1kUsd: 0, outputCostPer1kUsd: 0 },
  additionalModels: [], embeddingIdentity: { provider: "fixture-embeddings", model: "fixture-vector" },
  rerankerIdentity: { provider: "fixture-reranker", model: "fixture-rank" },
  claimMode: "extractive", minimumScore: 0.3, maxSteps: 8, timeoutMs: 10_000,
  requireStructuredOutput: true, retrievalTopK: 5, maxOutputTokens: 500,
  maxEstimatedCostUsd: 0.1, autoMaxTotalInputTokens: 120_000,
  cacheTtlSeconds: 3_600, cacheMinimumSimilarity: 0.96,
  tenantDailyQuestionLimit: 200, userDailyQuestionLimit: 30,
};

test("chat uses replacement application workflow, tracing and execution ports without an SDK runtime", async () => {
  const configured: AnswerWorkflowOptions[] = [];
  const calls: string[] = [];
  const original: GroundedQuestionWorkflow = {
    answer: async (input) => { input.signal?.throwIfAborted(); calls.push("answer"); return { answer: "A workspace contains its own documents.", sources: [] }; },
    prepare: async () => null,
    answerPrepared: async () => ({ answer: "No evidence", sources: [], refusalReason: "insufficient_context" }),
  };
  const runtime = createChatRuntime({
    embeddings: { embed: async () => [1, 0] },
    searchDocuments: { execute: async () => { throw new Error("A replacement workflow owns retrieval."); } },
    semanticCache: { findSimilar: async () => null, put: async () => {}, invalidateTenant: async () => {} },
    usageMetrics: { record: async () => { calls.push("usage"); }, summarize: async () => { throw new Error("Unexpected summary."); } },
    workspaceModelPolicies: { get: async () => null },
    workflowFactory: (_retriever, _generator, workflowOptions) => { configured.push(workflowOptions); return original; },
    tracing: (workflow) => ({ answer: async (input) => { calls.push("trace"); return workflow.answer(input); } }),
    chatExecution: { version: "alternative-chat-v1", execute: async (_scope, work, signal) => { signal.throwIfAborted(); calls.push("execute"); await work.reserveQuota(); } },
    quota: { consumeQuestion: async () => ({ allowed: true, used: 1, limit: 200 }) },
    aiProviders: {
      createAnswer: (input) => ({ checkpointKey: input.checkpointKey, generate: async () => { throw new Error("Unexpected generator call."); } }),
      createClaimVerifier: () => ({ requiresExtractiveAnswer: true, verify: async () => ({ method: "extractive", supported: true, claims: 0, unsupported: 0 }) }),
    },
    options,
  });
  assert.equal(runtime.bindings.chatVersion, "alternative-chat-v1");
  assert.equal(configured[0]?.workflowId, "default");
  assert.equal(configured[0]?.maxSteps, options.maxSteps);
  assert.equal(configured[0]?.timeoutMs, options.timeoutMs);
  assert.equal(runtime.defaultChat.workflow, original);
  const selected = await runtime.bindings.resolveChat(tenantId);
  assert.ok(selected);
  const cacheVariant = JSON.stringify([
    "rag-claims-v2", "extractive", "fixture-embeddings", "fixture-vector",
    "fixture-reranker", "fixture-rank", 5, 0.3, true, 500,
  ]);
  const signature = createHash("sha256").update(JSON.stringify([
    ["default", "ollama", "fixture-chat", 0, 0], cacheVariant, 500, "extractive",
  ])).digest("hex");
  assert.equal(selected.signature, signature);
  const answer = await selected.execute({ tenantId, actorKey: `user:${actorId}`, question: "What is a workspace?", bypassCache: true });
  assert.equal(answer.answer, "A workspace contains its own documents.");
  assert.deepEqual(calls, ["trace", "answer", "usage"]);
  const signal = new AbortController().signal;
  await runtime.bindings.runChat({ tenantId, actorId, runId: jobId }, {
    reserveQuota: async () => true,
    answer: async () => { throw new Error("Replacement executor owns scheduling."); },
  }, signal);
  assert.equal(calls.at(-1), "execute");
  const cancelled = new AbortController();
  const reason = new Error("Fixture cancelled");
  cancelled.abort(reason);
  await assert.rejects(runtime.bindings.runChat({ tenantId, actorId, runId: jobId }, {
    reserveQuota: async () => { throw new Error("Cancellation must stop quota work."); },
    answer: async () => { throw new Error("Cancellation must stop generation."); },
  }, cancelled.signal), (error) => error === reason);
});

function evaluationRun(): EvaluationRun {
  return {
    id: jobId, tenantId, datasetName: "fixture", datasetVersion: "v1", commitSha: null,
    embeddingProvider: "fixture", embeddingModel: "fixture", chatProvider: "fixture", chatModel: "fixture",
    totalCases: 1, hitRate: 1, meanReciprocalRank: 1, faithfulness: null, contextPrecision: 1,
    injectionPassRate: 1, passed: true, durationMs: 1, failureDetails: {}, createdAt: new Date(0),
  };
}

test("evaluation accepts a replacement workflow and an in-memory repository through existing ports", async () => {
  const result = evaluationRun();
  const stored: EvaluationRun[] = [];
  const evaluations: EvaluationRepository = {
    create: async (input) => { const created = { ...input, id: jobId, createdAt: new Date(0) }; stored.push(created); return created; },
    list: async (workspace, limit) => stored.filter((run) => run.tenantId === workspace).slice(0, limit),
  };
  let calls = 0;
  const controller = new AbortController();
  const services = createEvaluationServices({
    evaluations,
    searchDocuments: { execute: async () => { throw new Error("Replacement workflow owns retrieval."); } },
    models: { embeddingProvider: "fixture", embeddingModel: "fixture", chatProvider: "fixture", chatModel: "fixture" },
    aiProviders: { createEvaluationJudge: () => undefined },
    chatBindings: { resolveEvaluationModel: async () => undefined },
    embeddingIdentity: async () => ({ provider: "fixture", model: "fixture", version: "v1" }),
    demoLibraryRepository: { sourceStates: async () => [{ source: "golden/rag-fundamentals", state: "ready", documentId: null, jobId: null }] },
    workflow: { version: "alternative-evaluation-v1", workflow: { execute: async (input) => {
      calls++; assert.equal(input.tenantId, tenantId); assert.equal(input.effort, "standard"); assert.equal(input.signal, controller.signal);
      const { id: _id, createdAt: _createdAt, ...record } = result;
      return evaluations.create(record);
    } } },
  });
  assert.equal(services.evaluationVersion, "alternative-evaluation-v1");
  assert.equal(services.runEvaluation.supportsFaithfulness, false);
  assert.deepEqual(await services.runEvaluation.execute({ tenantId, signal: controller.signal }), result);
  assert.equal(calls, 1);
  assert.deepEqual(await services.listEvaluationRuns(tenantId, 5), [result]);
  assert.deepEqual(await services.listEvaluationRuns(actorId, 5), []);
});

function snapshot(input: WorkflowAdmission): WorkflowSnapshot {
  const now = new Date(0);
  return { ...input, status: "queued", stage: null, steps: 0, calls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0,
    attempts: 0, errorCode: null, resultId: null, createdAt: now, updatedAt: now, expiresAt: now, deadlineAt: now, approvedBy: null };
}

function alternateEngine() {
  const handlers = new Map<WorkflowKind, WorkflowHandler>();
  const admissions: WorkflowAdmission[] = [];
  let closes = 0;
  const repository: WorkflowRepository = {
    admit: async (input) => snapshot(input), claim: async () => null, heartbeat: async () => true,
    release: async () => {}, finish: async () => true, reserve: async () => {}, event: async () => {},
    get: async () => null, list: async () => [], approve: async () => false, cancel: async () => false,
    effect: async (_lease, _key, _reservation, operation) => operation(), prune: async () => 0,
  };
  const engine: WorkflowEngine = {
    repository, register: (kind, handler) => { handlers.set(kind, handler); },
    submit: async (input) => { admissions.push(input); return snapshot(input); }, cancel: async () => false,
    start() {}, close: async () => { closes++; },
  };
  return { engine, handlers, admissions, closes: () => closes };
}

test("ingestion registers a replacement workflow against an independent engine with unchanged plan and budget guards", async () => {
  const runtime = alternateEngine();
  const now = new Date(0);
  const job: IngestionJob = {
    id: jobId, tenantId, documentId: null, source: "fixture.txt", title: null, filename: "fixture.txt", mimeType: "text/plain",
    payload: Buffer.from("Fixture"), storagePath: null, status: "processing", progress: 0, error: null,
    chunkCount: null, highRiskChunks: null, createdAt: now, updatedAt: now,
  };
  const ingestionOptions: IngestionWorkflowOptions = { chunkSize: 900, chunkOverlap: 150, ocrEnabled: true, ocrLanguages: "eng+por", ocrMaxPages: 20, ocrTimeoutMs: 30_000, maxCostUsd: 0.1 };
  const calls: string[] = [];
  const enqueue = createIngestionWorkflow({
    jobs: { readForProcessing: async (id, workspace) => id === jobId && workspace === tenantId ? job : null },
    workflow: { version: "alternative-ingestion-v1", execute: async (received, signal) => { signal.throwIfAborted(); assert.equal(received, job); calls.push("ingest"); return { id: actorId, chunkCount: 2, highRiskChunks: 0 }; } },
    engine: runtime.engine, embeddingVersion: async () => "index-v1", options: ingestionOptions,
  });
  assert.ok(enqueue);
  await enqueue(job);
  const admission = runtime.admissions[0]!;
  assert.equal(admission.version, "alternative-ingestion-v1");
  assert.equal(admission.budget.maxCostMicros, 100_000);
  assert.equal(admission.budget.timeoutMs, 300_000);
  const plan = createHash("sha256").update(JSON.stringify(["alternative-ingestion-v1", 900, 150, true, "eng+por", 20, 30_000])).digest("hex");
  assert.deepEqual(admission.input, { jobId, plan, indexVersion: "index-v1" });
  const lease = { ...snapshot(admission), leaseToken: "fixture-lease", input: admission.input };
  const handler = runtime.handlers.get("ingestion")!;
  assert.equal(await handler.authorize(lease), true);
  assert.equal(await handler.authorize({ ...lease, tenantId: actorId }), false);
  const changed = { ...lease, input: { jobId, plan: "changed", indexVersion: "index-v1" } };
  assert.equal(await handler.authorize(changed), false);
  assert.equal(await handler.authorize({ ...lease, input: { jobId, plan, indexVersion: "index-v2" } }), false);
  const signal = new AbortController().signal;
  assert.deepEqual(await handler.run(lease, signal), { resultId: actorId });
  assert.deepEqual(calls, ["ingest"]);
});

test("workspace workflows bind an alternative engine without storage or checkpoint SDK types", async () => {
  const runtime = alternateEngine();
  let member = true;
  const workflows = createWorkspaceWorkflowServices({
    engine: runtime.engine,
    chat: {
      chatVersion: "alternative-chat-v1",
      resolveChat: async () => ({ modelId: "default", signature: "fixture-signature", execute: async () => ({ answer: "Fixture", sources: [] }) }),
      resolveEvaluationModel: async () => undefined, consumeQuota: async () => false, runChat: async () => {},
    },
    runEvaluation: { preflight: async () => {}, execute: async () => evaluationRun() },
    evaluationVersion: "alternative-evaluation-v1",
    member: async (user, workspace) => member && user === actorId && workspace === tenantId
      ? { tenantId, tenantName: "Fixture", tenantSlug: "fixture", role: "owner" } : null,
    embeddingVersion: async () => "index-v1",
    options: { chatMaxOutputTokens: 500, chatMaxEstimatedCostUsd: 0.1, chatTimeoutMs: 10_000, evaluationMaxCostUsd: 0.2 },
  });
  assert.ok(workflows);
  assert.equal(runtime.handlers.get("chat")?.version, "alternative-chat-v1");
  assert.equal(runtime.handlers.get("evaluation")?.version, "alternative-evaluation-v1");
  await workflows.startChat({ tenantId, actorId, runId: jobId }, { question: "What is a workspace?" });
  await workflows.startEvaluation(tenantId, actorId, {});
  assert.deepEqual(runtime.admissions.map((input) => input.budget), [
    { maxSteps: 50, maxCalls: 16, maxInputTokens: 320_000, maxOutputTokens: 5_600, maxCostMicros: 100_000, timeoutMs: 10_000 },
    { maxSteps: 50, maxCalls: 32, maxInputTokens: 500_000, maxOutputTokens: 16_000, maxCostMicros: 200_000, timeoutMs: 120_000 },
  ]);
  member = false;
  await assert.rejects(workflows.startChat({ tenantId, actorId, runId: jobId }, { question: "What is a workspace?" }),
    (error) => error instanceof WorkflowGuardError && error.code === "authorization_revoked");
  assert.equal(runtime.admissions.length, 2);
  await workflows.close();
  await workflows.close();
  assert.equal(runtime.closes(), 1);
});
