import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { parseRuntimeConfiguration } from "../configuration/environment.js";
import { buildApp } from "../http-server.js";
const tenantId = "22e83cdd-ee9f-42c0-b508-56ca0eb3416a",
  other = "129f4b64-1268-4029-82b3-3d56f6c419b9",
  userId = "d3941278-bb4e-4021-b057-fb91ebf7c7de",
  runId = "f3b16d6a-5627-40f1-8ea7-70988d0720b1";
const headers = { authorization: "Bearer fixture", "x-workspace-id": tenantId };
async function fixture(t: TestContext, role: "owner" | "viewer" = "owner") {
  const configuration = parseRuntimeConfiguration({ SUPABASE_URL: "https://workflows.example.test", SUPABASE_PUBLISHABLE_KEY: "fixture" });
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ id: userId, aud: "authenticated", role: "authenticated" }),
  );
  const snapshot = {
    tenantId,
    actorId: userId,
    runId,
    kind: "evaluation",
    version: "evaluation-v2",
    status: "waiting_approval",
    stage: "approval",
    steps: 1,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costMicros: 0,
    budget: {
      maxSteps: 50,
      maxCalls: 32,
      maxInputTokens: 500_000,
      maxOutputTokens: 16000,
      maxCostMicros: 200_000,
      timeoutMs: 120000,
    },
    attempts: 1,
    errorCode: null,
    resultId: null,
    approvedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
    deadlineAt: new Date(Date.now() + 60000),
    input: { private: "must not return" },
    leaseToken: "must not return",
  };
  const start = t.mock.fn(async () => snapshot),
    approve = t.mock.fn(async () => true),
    cancel = t.mock.fn(async () => true),
    audit = t.mock.fn(async () => {});
  const app = await buildApp({
    workflows: {
      start: () => {},
      close: async () => {},
      startEvaluation: start,
      approve,
      cancel,
      repository: { list: async () => [snapshot], get: async () => snapshot },
    },
    recordAuditEvent: audit,
    listEvaluationRuns: async () => [],
    runEvaluation: { supportsFaithfulness: true },
    findMembership: async (actor: string, tenant: string) =>
      actor === userId && tenant === tenantId
        ? { tenantId, tenantName: "Fixture", tenantSlug: "fixture", role }
        : null,
  } as unknown as Parameters<typeof buildApp>[0], { configuration, isProduction: true });
  t.after(() => app.close());
  return { app, start, approve, cancel, audit };
}
test("evaluation actions require current owner, explicit workspace and an allowlisted action", async (t) => {
  const { app, start, approve } = await fixture(t);
  const path = `/v1/admin/evaluation-workflows/${runId}/approve`;
  assert.equal(
    (await app.inject({ method: "POST", url: path })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: path,
        headers: { authorization: "Bearer fixture" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: path,
        headers: { ...headers, "x-workspace-id": other },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: path.replace("approve", "execute_sql"),
        headers,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/admin/evaluation-workflows",
        headers,
        payload: { includeFaithfulness: true, tenantId: other },
      })
    ).statusCode,
    400,
  );
  assert.equal(start.mock.callCount(), 0);
  assert.equal(approve.mock.callCount(), 0);
  const response = await app.inject({ method: "POST", url: path, headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(approve.mock.calls[0]!.arguments, [
    { tenantId, actorId: userId, runId },
    userId,
  ]);
  assert.doesNotMatch(
    response.body,
    /must not return|actorId|leaseToken|approvedBy|deadlineAt/,
  );
});
test("viewer cannot create or approve evaluation workflows", async (t) => {
  const { app, start, approve } = await fixture(t, "viewer");
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/admin/evaluation-workflows",
        headers,
        payload: {},
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/v1/admin/evaluation-workflows/${runId}/approve`,
        headers,
      })
    ).statusCode,
    403,
  );
  assert.equal(start.mock.callCount(), 0);
  assert.equal(approve.mock.callCount(), 0);
});
