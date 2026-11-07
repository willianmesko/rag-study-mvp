import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { knowledgeStatusSchema } from "@rag-study/contracts";
import { config } from "../../config.js";
import { buildApp } from "../http-server.js";

const workspace = "11111111-1111-4111-a111-111111111111";
const other = "33333333-3333-4333-a333-333333333333";
const user = "22222222-2222-4222-a222-222222222222";
const headers = { authorization: "Bearer fixture", "x-workspace-id": workspace };

async function fixture(t: TestContext, demo = false) {
  const saved = { SUPABASE_URL: config.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: config.SUPABASE_PUBLISHABLE_KEY,
    API_KEY: config.API_KEY, DEMO_MODE: config.DEMO_MODE };
  const environment = process.env.NODE_ENV;
  Object.assign(config, { SUPABASE_URL: "https://knowledge.example.test", SUPABASE_PUBLISHABLE_KEY: "fixture", API_KEY: undefined, DEMO_MODE: demo });
  process.env.NODE_ENV = "production";
  t.after(() => { Object.assign(config, saved); if (environment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = environment; });
  t.mock.method(globalThis, "fetch", async () => Response.json({ id: user, aud: "authenticated", role: "authenticated" }));
  const get = t.mock.fn(async (_id: string) => ({ indexedDocuments: 2, passages: 5, processingJobs: 1, failedJobs: 0 }));
  const app = await buildApp({ knowledgeStatus: { get },
    findMembership: async (actor: string, id: string) => actor === user && id === workspace
      ? { tenantId: workspace, tenantName: "Fixture", tenantSlug: "fixture", role: "viewer" } : null
  } as unknown as Parameters<typeof buildApp>[0]);
  t.after(() => app.close());
  return { app, get };
}

test("knowledge readiness requires explicit membership, including for viewers", async (t) => {
  const { app, get } = await fixture(t);
  assert.equal((await app.inject("/v1/knowledge/status")).statusCode, 401);
  for (const [value, status] of [[undefined, 400], ["bad-id", 400], [other, 403]] as const) {
    assert.equal((await app.inject({ url: "/v1/knowledge/status", headers: {
      authorization: "Bearer fixture", ...(value ? { "x-workspace-id": value } : {})
    } })).statusCode, status);
  }
  assert.equal(get.mock.callCount(), 0);
  const response = await app.inject({ url: "/v1/knowledge/status", headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(knowledgeStatusSchema.parse(response.json()), { indexedDocuments: 2, passages: 5, processingJobs: 1, failedJobs: 0 });
  assert.deepEqual(get.mock.calls[0]!.arguments, [workspace]);
});

test("anonymous readiness is restricted to the public demo corpus, with no tenant override", async (t) => {
  const { app, get } = await fixture(t, true);
  const response = await app.inject("/v1/knowledge/status");
  assert.equal(response.statusCode, 200);
  assert.deepEqual(get.mock.calls[0]!.arguments, [config.DEFAULT_TENANT_ID]);
  for (const query of [`tenantId=${other}`, `workspaceId=${other}`, "limit=100"])
    assert.equal((await app.inject(`/v1/knowledge/status?${query}`)).statusCode, 400);
  assert.equal((await app.inject({ url: "/v1/knowledge/status", headers: { "x-workspace-id": other } })).statusCode, 401);
  assert.equal(get.mock.callCount(), 1);
});
