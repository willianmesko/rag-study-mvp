import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Fastify from "fastify";
import { ZodError } from "zod";
import { currentProviderUsageScope } from "../../platform/observability/provider-usage-context.js";
import { createChatModelSelection, type HttpChatModel } from "../../modules/chat/http/chat-models.js";
import { ingestionRoutes, type IngestionRoutesDependencies } from "../../modules/ingestion/ingestion.controller.js";
import { searchRoutes, type SearchRoutesDependencies } from "../../modules/knowledge/search.controller.js";
import { chatRoutes, type ChatRoutesDependencies } from "../../modules/chat/chat.controller.js";
import { evaluationRoutes, type EvaluationRoutesDependencies } from "../../modules/evaluations/evaluations.controller.js";
import { operationsRoutes, type OperationsRoutesDependencies } from "../../modules/usage/operations.controller.js";

const tenantId = "20000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000001";
const jobId = "30000000-0000-4000-8000-000000000001";
const actor = { ok: true as const, tenantId, userId, role: "owner" as const };
const quota = async () => ({ allowed: true, used: 1, limit: 10 });

function fixture(t: TestContext) {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof ZodError ? 400 : 500).send({ error: "Request failed." }));
  t.after(() => app.close());
  return app;
}

function models() {
  return createChatModelSelection({ models: new Map(), answerQuestion: { execute: async () => ({ answer: "Fixture", sources: [] }) }, routeAnswer: { execute: async () => ({ answer: "Fixture", sources: [] }) }, consumeQuestionQuota: quota });
}

test("ingestion preview plugin uses narrow ports, explicit scope, redaction and blocked high-risk passages", async (t) => {
  const app = fixture(t);
  const audit = t.mock.fn<IngestionRoutesDependencies["recordAuditEvent"]>(async () => {});
  const dependencies: IngestionRoutesDependencies = {
    authorizeMember: async () => actor,
    authorizeAdmin: async (_request, explicit) => { assert.equal(explicit, true); return actor; },
    queueDocumentUpload: { execute: async () => { throw new Error("Unexpected upload"); } },
    ingestDocument: { execute: async () => { throw new Error("Unexpected ingestion"); } },
    publicHtmlFetcher: { fetch: async () => { throw new Error("Unexpected network request"); } },
    listIngestionJobs: async () => [], listIngestionEvents: async () => [],
    previewIngestionPassages: async (input) => {
      assert.deepEqual(input, { tenantId, jobId });
      return { totalChunks: 2, passages: [
        { chunkId: jobId, ordinal: 0, content: "Contact owner@example.test for details.", security: { promptInjectionRisk: "low", signals: [] } },
        { chunkId: jobId, ordinal: 1, content: "PRIVATE_HIGH_RISK_SENTINEL", security: { promptInjectionRisk: "high", signals: [] } },
      ] };
    },
    retryIngestionJob: { execute: async () => {} },
    consumeAdminUploadQuota: quota, recordAuditEvent: audit,
    isDemoMode: () => false, requireLegacyIngestionKey: false, adminApiKey: () => undefined, defaultTenantId: () => tenantId,
  };
  app.register(ingestionRoutes, dependencies);
  const response = await app.inject(`/v1/admin/uploads/${jobId}/preview`);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().totalChunks, 2);
  assert.equal(response.json().passages[0].previewBlocked, false);
  assert.equal(response.json().passages[1].previewBlocked, true);
  assert.ok(!response.body.includes("owner@example.test") && !response.body.includes("PRIVATE_HIGH_RISK_SENTINEL"));
  assert.equal(audit.mock.calls[0].arguments[0].action, "ingestion.preview_read");
  assert.equal(audit.mock.calls[0].arguments[0].tenantId, tenantId);
});

test("search plugin preserves explicit private readiness and provider scope without returning full source contents", async (t) => {
  const app = fixture(t);
  const explicit: boolean[] = [];
  const dependencies: SearchRoutesDependencies = {
    resolveQueryScope: async (_request, required = false) => { explicit.push(required); return { ok: true, tenantId, actorKey: `user:${userId}`, authenticated: true }; },
    knowledgeStatus: { get: async () => ({ indexedDocuments: 1, passages: 2, processingJobs: 0, failedJobs: 0 }) },
    searchDocuments: { execute: async (input) => {
      assert.equal(input.tenantId, tenantId); assert.ok(input.signal instanceof AbortSignal);
      assert.deepEqual(currentProviderUsageScope(), { tenantId, actorKey: `user:${userId}` });
      return [{ chunkId: jobId, documentId: jobId, source: "fixture.md", title: null, ordinal: 0, score: 0.8, content: "Email owner@example.test. " + "x".repeat(800), security: { promptInjectionRisk: "low", signals: [] } }];
    } },
    shutdown: new AbortController().signal,
  };
  app.register(searchRoutes, dependencies);
  assert.equal((await app.inject({ url: "/v1/knowledge/status", headers: { authorization: "Bearer fixture" } })).statusCode, 200);
  const response = await app.inject("/v1/search?q=sample");
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().results[0].previewTruncated, true);
  assert.ok(!response.body.includes("owner@example.test"));
  assert.deepEqual(explicit, [true, false]);
});

test("chat plugin resolves only backend-owned models and rejects unknown aliases before quota or generation", async (t) => {
  const app = fixture(t);
  const answer = t.mock.fn(async () => ({ answer: "Fixture answer", sources: [] }));
  const consumeQuestionQuota = t.mock.fn(quota);
  const model: HttpChatModel = {
    descriptor: { id: "approved", label: "Approved", provider: "ollama", isDefault: true },
    model: "server-owned-provider-id", inputCostPer1kUsd: 0, outputCostPer1kUsd: 0,
    generator: { generate: async () => "unused" }, answerQuestion: { execute: answer },
  };
  const selection = createChatModelSelection({ models: new Map([["approved", model]]), policies: { get: async () => ({ allowedModelIds: ["approved"], defaultModelId: "approved", auto: null }) }, answerQuestion: { execute: answer }, routeAnswer: { execute: answer }, consumeQuestionQuota });
  const dependencies: ChatRoutesDependencies = {
    authorizeMember: async () => actor,
    resolveQueryScope: async () => ({ ok: true, tenantId, actorKey: `user:${userId}`, authenticated: true }),
    models: selection, consumeQuestionQuota,
    compareAnswers: { execute: async () => { throw new Error("Unexpected comparison"); } },
    chatRuns: { create: async () => false, append: async () => false, cancel: async () => null, get: async () => null, read: async () => null, pruneExpired: async () => 0 },
    answerRuns: { start: async () => {}, cancel: async () => null },
    shutdown: new AbortController().signal, questionRateLimitMax: 10,
  };
  app.register(chatRoutes, dependencies);
  const unknown = await app.inject({ method: "POST", url: "/v1/qa", payload: { question: "A fixture question?", modelId: "unapproved" } });
  assert.equal(unknown.statusCode, 400); assert.equal(unknown.json().code, "model_unavailable");
  assert.equal(consumeQuestionQuota.mock.callCount(), 0); assert.equal(answer.mock.callCount(), 0);
  const approved = await app.inject({ method: "POST", url: "/v1/qa", payload: { question: "A fixture question?", modelId: "approved" } });
  assert.equal(approved.statusCode, 200); assert.equal(approved.json().model.id, "approved");
  assert.equal(consumeQuestionQuota.mock.callCount(), 1); assert.equal(answer.mock.callCount(), 1);
});

test("operations and evaluations preserve owner gates, bounded inputs and replay authorization with narrow fixtures", async (t) => {
  const app = fixture(t);
  let allowed = false;
  const authorizeOwner: OperationsRoutesDependencies["authorizeOwner"] = async () => allowed ? actor : { ok: false, status: 403, error: "Workspace owner access required." };
  const summary = { requests: 1, cacheHits: 0, inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.001, averageLatencyMs: 10, providerFailures: 0 };
  const getUsageSummary = t.mock.fn(async () => summary);
  const replay = t.mock.fn<NonNullable<OperationsRoutesDependencies["budgetAlerts"]>["replay"]>(async (input) => ({ replayed: true, id: input.id }));
  const listEvaluationRuns = t.mock.fn(async () => []);
  const execute = t.mock.fn<EvaluationRoutesDependencies["runEvaluation"]["execute"]>(async () => { throw new Error("Unexpected evaluation"); });
  app.register(operationsRoutes, {
    authorizeOwner, getUsageSummary, usageAlertThresholdUsd: () => 0.0005,
    budgetAlerts: { configured: true, status: async () => ({ configured: true, channel: "webhook", windowDays: 30, deduplication: "daily", deliveries: [], recent: [] }), replay },
  });
  app.register(evaluationRoutes, { authorizeOwner, models: models(), listEvaluationRuns, runEvaluation: { supportsFaithfulness: false, execute }, recordAuditEvent: async () => {} });
  assert.equal((await app.inject("/v1/admin/usage?days=0")).statusCode, 403);
  assert.equal((await app.inject("/v1/admin/evaluations")).statusCode, 403);
  assert.equal(getUsageSummary.mock.callCount(), 0); assert.equal(listEvaluationRuns.mock.callCount(), 0);
  allowed = true;
  assert.equal((await app.inject("/v1/admin/usage?days=0")).statusCode, 400);
  const usage = await app.inject("/v1/admin/usage?days=30");
  assert.equal(usage.statusCode, 200); assert.equal(usage.json().alert.triggered, true);
  assert.equal((await app.inject("/v1/admin/evaluations")).statusCode, 200);
  const result = await app.inject({ method: "POST", url: `/v1/admin/alerts/${jobId}/replay`, headers: { "idempotency-key": "replay-fixed-fixture-001" }, payload: { expectedAttempts: 2 } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(replay.mock.calls[0].arguments[0], { tenantId, actorId: userId, id: jobId, expectedAttempts: 2, idempotencyKey: "replay-fixed-fixture-001" });
  assert.equal((await app.inject({ method: "POST", url: "/v1/admin/evaluations/run", payload: { modelId: "unapproved" } })).statusCode, 400);
  assert.equal(execute.mock.callCount(), 0);
});
