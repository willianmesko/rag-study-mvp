import {currentCorrelationId} from '../../application/observability.js';
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { config } from "../../config.js";
const tenantId = randomUUID(),
  userId = randomUUID(),
  id = randomUUID();
async function fixture(t: TestContext, role = "owner") {
  const saved = {
    SUPABASE_URL: config.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: config.SUPABASE_PUBLISHABLE_KEY,
    API_KEY: config.API_KEY,
  };
  Object.assign(config, {
    SUPABASE_URL: "https://fixture.example.com",
    SUPABASE_PUBLISHABLE_KEY: "fixture",
    API_KEY: undefined,
  });
  t.after(() => Object.assign(config, saved));
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ id: userId, aud: "authenticated", role: "authenticated" }),
  );
  const replay = t.mock.fn(async (input: unknown) => ({ replayed: true, id }));
  const status = t.mock.fn(async () => ({ configured: true, correlationId:currentCorrelationId(), recent: [] }));
  const app = await buildApp({
    budgetAlerts: { configured: true, replay, status, work: async () => {} },
    findMembership: async (user: string, workspace: string) =>
      user === userId && workspace === tenantId
        ? { tenantId, tenantName: "Fixture", tenantSlug: "fixture", role }
        : null,
  } as unknown as Parameters<typeof buildApp>[0]);
  t.after(() => app.close());
  return { app, replay, status };
}
test("notification inspection and replay require owner, explicit workspace, bounded schema and replay key", async (t) => {
  const { app, replay } = await fixture(t),
    headers = {
      authorization: "Bearer fixture",
      "x-workspace-id": tenantId,
      "idempotency-key": "fixture-replay-command",
    };
  assert.equal((await app.inject("/v1/admin/alerts")).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        url: "/v1/admin/alerts",
        headers: { authorization: "Bearer fixture" },
      })
    ).statusCode,
    400,
  );
  for (const body of [
    { expectedAttempts: 0 },
    { expectedAttempts: 1, tenantId: randomUUID() },
  ])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/v1/admin/alerts/${id}/replay`,
          headers,
          payload: body,
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/v1/admin/alerts/${id}/replay`,
        headers: {
          authorization: headers.authorization,
          "x-workspace-id": tenantId,
        },
        payload: { expectedAttempts: 1 },
      })
    ).statusCode,
    400,
  );
  const correlated=await app.inject({url:'/v1/admin/alerts',headers:{...headers,'x-request-id':'attacker-chosen-id'}});
  assert.equal(correlated.statusCode,200);
  assert.notEqual(correlated.headers['x-request-id'],'attacker-chosen-id');
  assert.equal(correlated.json().correlationId,correlated.headers['x-request-id']);
  assert.equal(replay.mock.callCount(), 0);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/v1/admin/alerts/${id}/replay`,
        headers,
        payload: { expectedAttempts: 1 },
      })
    ).statusCode,
    200,
  );
  assert.deepEqual(replay.mock.calls[0].arguments[0], {
    tenantId,
    actorId: userId,
    id,
    expectedAttempts: 1,
    idempotencyKey: "fixture-replay-command",
  });
});
test("viewers cannot inspect or replay notification deliveries", async (t) => {
  const { app, replay, status } = await fixture(t, "viewer"),
    headers = {
      authorization: "Bearer fixture",
      "x-workspace-id": tenantId,
      "idempotency-key": "fixture-replay-command",
    };
  assert.equal(
    (await app.inject({ url: "/v1/admin/alerts", headers })).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/v1/admin/alerts/${id}/replay`,
        headers,
        payload: { expectedAttempts: 1 },
      })
    ).statusCode,
    403,
  );
  assert.equal(replay.mock.callCount(), 0);
  assert.equal(status.mock.callCount(), 0);
});
