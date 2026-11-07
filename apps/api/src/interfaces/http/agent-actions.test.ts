import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { AgentActionError, AgentActionService, type AgentActionSnapshot } from "../../application/agent-actions/agent-action-service.js";
import { registerAgentActionRoutes } from "./agent-actions.js";

const tenantId = "423b853e-58ac-4237-8cfe-9716d688179e";
const userId = "9fb4311c-d406-4734-9898-40329ec6418d";
const actionId = "171495d5-029c-4d8d-9d64-fef598ecb783";
const ownerHeaders = { authorization: "Bearer owner", "x-workspace-id": tenantId };
const requestHeaders = { ...ownerHeaders, "idempotency-key": "explicit_action_key" };
const snapshot: AgentActionSnapshot = {
  id: actionId, action: "run_evaluation", status: "pending_approval", attempts: 0, evaluationRunId: null,
  createdAt: new Date("2026-01-01T00:00:00Z"), expiresAt: new Date("2026-01-02T00:00:00Z"),
  events: [{ status: "pending_approval", reason: "requested", at: new Date("2026-01-01T00:00:00Z") }]
};

async function fixture(t: TestContext) {
  let action = { ...snapshot, events: [...snapshot.events] };
  let requests = 0;
  let approvals = 0;
  const service = new AgentActionService({
    async request(scope) {
      assert.deepEqual(scope, { tenantId, userId, keyHash: scope.keyHash });
      assert.match(scope.keyHash, /^[a-f0-9]{64}$/);
      requests += 1;
      return action;
    },
    async approve(scope) {
      assert.deepEqual(scope, { tenantId, userId, actionId });
      approvals += 1;
      action = { ...action, status: "queued", events: [...action.events, { status: "queued", reason: "approved", at: new Date("2026-01-01T00:01:00Z") }] };
      return action;
    },
    async get(scope) {
      if (scope.actionId !== actionId) throw new AgentActionError("not_found");
      assert.deepEqual(scope, { tenantId, userId, actionId });
      return action;
    }
  });
  const app = Fastify();
  await app.register(rateLimit, { max: 100, timeWindow: 60_000 });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Invalid request." });
    if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 429) {
      return reply.code(429).send({ error: "Too many requests." });
    }
    return reply.code(500).send({ error: "Unexpected fixture error." });
  });
  registerAgentActionRoutes(app, service, async (request) => {
    const token = request.headers.authorization;
    if (!token) return { ok: false, status: 401, error: "Authentication required." };
    if (!request.headers["x-workspace-id"]) return { ok: false, status: 400, error: "Select a workspace.", code: "workspace_required" };
    if (request.headers["x-workspace-id"] !== tenantId) return { ok: false, status: 403, error: "Workspace membership required." };
    return { ok: true, userId, tenantId, role: token === "Bearer owner" ? "owner" : "viewer" };
  });
  t.after(() => app.close());
  return { app, calls: () => ({ requests, approvals }) };
}

test("proposing an evaluation requires scope and an idempotency key and never grants approval", async (t) => {
  const { app, calls } = await fixture(t);
  for (const headers of [{}, { authorization: ownerHeaders.authorization }, ownerHeaders]) {
    const response = await app.inject({ method: "POST", url: "/v1/agent-actions", headers, payload: { action: "run_evaluation" } });
    assert.ok([400, 401].includes(response.statusCode));
  }
  const proposed = await app.inject({ method: "POST", url: "/v1/agent-actions", headers: requestHeaders, payload: { action: "run_evaluation" } });
  assert.equal(proposed.statusCode, 202);
  assert.equal(proposed.json().action.status, "pending_approval");
  assert.deepEqual(calls(), { requests: 1, approvals: 0 });
  const overreaching = await app.inject({
    method: "POST", url: "/v1/agent-actions", headers: requestHeaders, payload: { action: "run_evaluation", approve: true }
  });
  assert.equal(overreaching.statusCode, 400);
  assert.deepEqual(calls(), { requests: 1, approvals: 0 });
});

test("only an owner can request, approve or read an action", async (t) => {
  const { app, calls } = await fixture(t);
  const headers = { ...requestHeaders, authorization: "Bearer viewer" };
  for (const request of [
    { method: "POST" as const, url: "/v1/agent-actions", payload: { action: "run_evaluation" } },
    { method: "POST" as const, url: `/v1/agent-actions/${actionId}/approve`, payload: { approve: true } },
    { method: "GET" as const, url: `/v1/agent-actions/${actionId}` }
  ]) {
    const response = await app.inject({ ...request, headers });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, "forbidden");
  }
  assert.deepEqual(calls(), { requests: 0, approvals: 0 });
});

test("approval requires an explicit strict body and returns a bounded status replay", async (t) => {
  const { app, calls } = await fixture(t);
  for (const payload of [{}, { approve: false }, { approve: true, tool: "send_email" }]) {
    const response = await app.inject({ method: "POST", url: `/v1/agent-actions/${actionId}/approve`, headers: ownerHeaders, payload });
    assert.equal(response.statusCode, 400);
  }
  const approved = await app.inject({ method: "POST", url: `/v1/agent-actions/${actionId}/approve`, headers: ownerHeaders, payload: { approve: true } });
  assert.equal(approved.statusCode, 202);
  assert.equal(approved.json().action.status, "queued");
  const replay = await app.inject({ method: "GET", url: `/v1/agent-actions/${actionId}`, headers: ownerHeaders });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(Object.keys(replay.json().action).sort(), [
    "action", "attempts", "createdAt", "evaluationRunId", "events", "expiresAt", "id", "status"
  ]);
  assert.deepEqual(replay.json().action.events.map((event: { reason: string }) => event.reason), ["requested", "approved"]);
  assert.deepEqual(calls(), { requests: 0, approvals: 1 });
  const unknown = await app.inject({
    method: "GET", url: "/v1/agent-actions/579d655e-5f06-4e64-ad75-92361d4c3710", headers: ownerHeaders
  });
  assert.equal(unknown.statusCode, 404);
});

test("proposal rate limits apply before a client can grow the action queue", async (t) => {
  const { app, calls } = await fixture(t);
  for (let count = 0; count < 6; count++) {
    assert.equal((await app.inject({
      method: "POST", url: "/v1/agent-actions", headers: requestHeaders, payload: { action: "run_evaluation" }
    })).statusCode, 202);
  }
  assert.equal((await app.inject({
    method: "POST", url: "/v1/agent-actions", headers: requestHeaders, payload: { action: "run_evaluation" }
  })).statusCode, 429);
  assert.deepEqual(calls(), { requests: 6, approvals: 0 });
});
