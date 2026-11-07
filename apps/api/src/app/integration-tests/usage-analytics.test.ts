import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { usageResponseSchema } from "@rag-study/contracts";
import { config } from "../../config.js";
import { buildApp } from "../http-server.js";
const tenant = "4c648f8c-1eaa-4276-b2df-32d8a18be961",
  other = "9484df30-1cec-42e3-a64a-15a90d38faf9",
  user = "0b41d067-2ad6-4546-8c24-72f723fa2a75";
async function fixture(t: TestContext, role = "owner") {
  const saved = {
    SUPABASE_URL: config.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: config.SUPABASE_PUBLISHABLE_KEY,
    API_KEY: config.API_KEY,
    USAGE_ALERT_THRESHOLD_USD: config.USAGE_ALERT_THRESHOLD_USD,
  };
  Object.assign(config, {
    SUPABASE_URL: "https://usage.example.test",
    SUPABASE_PUBLISHABLE_KEY: "fixture",
    API_KEY: undefined,
    USAGE_ALERT_THRESHOLD_USD: 0.5,
  });
  t.after(() => Object.assign(config, saved));
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ id: user, aud: "authenticated", role: "authenticated" }),
  );
  const summarize = t.mock.fn(async (_tenant: string, _days: number) => ({
    requests: 2,
    cacheHits: 0,
    inputTokens: 10,
    outputTokens: 10,
    estimatedCostUsd: 0.01,
    observedCostUsd: 0.6,
    effectiveCostUsd: 0.6,
    averageLatencyMs: 100,
    providerFailures: 0,
  }));
  const app = await buildApp({
    getUsageSummary: summarize,
    findMembership: async (actor: string, id: string) =>
      actor === user && id === tenant
        ? {
            tenantId: tenant,
            tenantName: "Fixture",
            tenantSlug: "fixture",
            role,
          }
        : null,
  } as unknown as Parameters<typeof buildApp>[0]);
  t.after(() => app.close());
  return { app, summarize };
}
test("usage is owner-only, explicitly workspace scoped and uses recorded cost for alerts", async (t) => {
  const { app, summarize } = await fixture(t),
    headers = { authorization: "Bearer fixture", "x-workspace-id": tenant };
  assert.equal((await app.inject("/v1/admin/usage")).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        url: "/v1/admin/usage",
        headers: { authorization: "Bearer fixture" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        url: "/v1/admin/usage",
        headers: { ...headers, "x-workspace-id": other },
      })
    ).statusCode,
    403,
  );
  for (const query of [
    "days=0",
    "days=91",
    "days=1.5",
    "days=7&tenantId=" + other,
  ])
    assert.equal(
      (await app.inject({ url: "/v1/admin/usage?" + query, headers }))
        .statusCode,
      400,
    );
  assert.equal(summarize.mock.callCount(), 0);
  const response = await app.inject({ url: "/v1/admin/usage?days=7", headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(summarize.mock.calls[0]!.arguments, [tenant, 7]);
  assert.equal(
    usageResponseSchema.parse(response.json()).alert.triggered,
    true,
  );
});
test("viewer cannot read model cost analytics", async (t) => {
  const { app, summarize } = await fixture(t, "viewer");
  assert.equal(
    (
      await app.inject({
        url: "/v1/admin/usage",
        headers: { authorization: "Bearer fixture", "x-workspace-id": tenant },
      })
    ).statusCode,
    403,
  );
  assert.equal(summarize.mock.callCount(), 0);
});
