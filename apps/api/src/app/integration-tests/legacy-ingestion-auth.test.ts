import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { buildApp } from "../http-server.js";
import { parseRuntimeConfiguration } from "../configuration/environment.js";

const adminKey = "synthetic-admin-key-for-tests";
const globalKey = "synthetic-global-key-for-tests";
const tenantId = "20000000-0000-4000-8000-000000000001";
const payload = { source: "synthetic-handbook.md", text: "A synthetic procedure for local authorization tests.", metadata: { ingestionJobId: "untrusted" } };
async function fixture(t: TestContext, environment: Record<string, string> = {}, isProduction = true) {
  const configuration = parseRuntimeConfiguration({ DEFAULT_TENANT_ID: tenantId, RATE_LIMIT_MAX: "1000", ...environment });
  const quota = t.mock.fn(async () => ({ allowed: true, used: 0, limit: 1000 }));
  const ingest = t.mock.fn(async (_input: unknown) => ({ id: "30000000-0000-4000-8000-000000000001", chunkCount: 1, highRiskChunks: 0 }));
  const audit = t.mock.fn(async () => {});
  const app = await buildApp({ consumeAdminUploadQuota: quota, ingestDocument: { execute: ingest }, recordAuditEvent: audit } as unknown as Parameters<typeof buildApp>[0],
    { configuration, isProduction });
  t.after(() => app.close());
  return { app, quota, ingest, audit };
}
test("private production without a maintenance key rejects anonymous and forged bearer ingestion before side effects", async (t) => {
  const { app, quota, ingest, audit } = await fixture(t);
  for (const headers of [{}, { "x-admin-api-key": adminKey }, { authorization: "Bearer forged-session", "x-workspace-id": tenantId }]) {
    const response = await app.inject({ method: "POST", url: "/v1/documents", headers, payload });
    assert.equal(response.statusCode, 401); assert.ok(!response.payload.includes(adminKey));
  }
  assert.equal(quota.mock.callCount(), 0); assert.equal(ingest.mock.callCount(), 0); assert.equal(audit.mock.callCount(), 0);
});
test("a configured production maintenance key rejects missing and wrong credentials before parsing and quota", async (t) => {
  const { app, quota, ingest, audit } = await fixture(t, { ADMIN_API_KEY: adminKey });
  for (const headers of [{}, { "x-admin-api-key": "wrong-secret" }]) {
    const response = await app.inject({ method: "POST", url: "/v1/documents", headers, payload: {} });
    assert.equal(response.statusCode, 401);
  }
  assert.equal(quota.mock.callCount(), 0); assert.equal(ingest.mock.callCount(), 0); assert.equal(audit.mock.callCount(), 0);
});
test("a valid production maintenance key preserves the server-owned default scope and original association guard", async (t) => {
  const { app, quota, ingest, audit } = await fixture(t, { ADMIN_API_KEY: adminKey });
  const response = await app.inject({ method: "POST", url: "/v1/documents", headers: {
    "x-admin-api-key": adminKey, "x-workspace-id": "20000000-0000-4000-8000-000000000002"
  }, payload });
  assert.equal(response.statusCode, 201); assert.equal(quota.mock.callCount(), 1); assert.equal(audit.mock.callCount(), 1);
  assert.deepEqual(ingest.mock.calls[0]?.arguments[0], { source: payload.source, text: payload.text, metadata: {}, tenantId });
});
test("the existing demo key requirement remains active outside and inside production", async (t) => {
  for (const production of [false, true]) {
    const { app, ingest } = await fixture(t, { DEMO_MODE: "true", ADMIN_API_KEY: adminKey }, production);
    assert.equal((await app.inject({ method: "POST", url: "/v1/documents", payload })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/v1/documents", headers: { "x-admin-api-key": adminKey }, payload })).statusCode, 201);
    assert.equal(ingest.mock.callCount(), 1);
  }
});
test("the global API-key flow remains authoritative and cannot be replaced by an admin key", async (t) => {
  const { app, ingest } = await fixture(t, { API_KEY: globalKey });
  for (const headers of [{}, { "x-api-key": "wrong-key" }, { "x-admin-api-key": adminKey }])
    assert.equal((await app.inject({ method: "POST", url: "/v1/documents", headers, payload })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/v1/documents", headers: { "x-api-key": globalKey }, payload })).statusCode, 201);
  assert.equal(ingest.mock.callCount(), 1);
});
test("local non-demo study execution keeps the existing keyless JSON ingestion path", async (t) => {
  const { app, ingest } = await fixture(t, {}, false);
  assert.equal((await app.inject({ method: "POST", url: "/v1/documents", payload })).statusCode, 201);
  assert.equal(ingest.mock.callCount(), 1);
});
