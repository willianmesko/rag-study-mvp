import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { config } from "../../config.js";
import { buildApp } from "../http-server.js";
import { frameworkRequestFailure } from "../../platform/http/request-errors.js";

const workspaceId = "11000000-0000-4000-8000-000000000001";
const userId = "22000000-0000-4000-8000-000000000001";

async function fixture(t: TestContext, options: { max?: number; workspaceFailure?: Error } = {}) {
  const previous = { API_KEY: config.API_KEY, DEMO_MODE: config.DEMO_MODE, UPLOAD_MAX_BYTES: config.UPLOAD_MAX_BYTES,
    RATE_LIMIT_MAX: config.RATE_LIMIT_MAX, SUPABASE_URL: config.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: config.SUPABASE_PUBLISHABLE_KEY };
  Object.assign(config, { API_KEY: undefined, DEMO_MODE: true, UPLOAD_MAX_BYTES: 1024, RATE_LIMIT_MAX: options.max ?? 100,
    SUPABASE_URL: "https://auth.example.test", SUPABASE_PUBLISHABLE_KEY: "fixture-public-key" });
  t.after(() => Object.assign(config, previous));
  const networkFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://auth.example.test/auth/v1/user") return Response.json({ id: userId, aud: "authenticated", role: "authenticated" });
    return networkFetch(input, init);
  });
  const changeRole = t.mock.fn(async () => true);
  const app = await buildApp({
    createWorkspace: async () => { throw options.workspaceFailure ?? new Error("private database detail"); },
    findMembership: async () => ({ tenantId: workspaceId, tenantName: "Team", tenantSlug: "team", role: "owner" }),
    changeWorkspaceMemberRole: changeRole,
  } as unknown as Parameters<typeof buildApp>[0]);
  t.after(() => app.close());
  return { app, changeRole };
}

test("actual Fastify parsing preserves JSON, MIME and size errors without reflecting input", async (t) => {
  const { app } = await fixture(t);
  for (const [type, payload, status, code] of [
    ["application/json", '{"PRIVATE_SENTINEL":', 400, "invalid_json"],
    ["application/json", "", 400, "invalid_json"],
    ["application/xml", "<PRIVATE_SENTINEL/>", 415, "unsupported_media_type"],
    ["application/json", JSON.stringify({ question: "PRIVATE_SENTINEL".repeat(10_000) }), 413, "request_too_large"],
  ] as const) {
    const response = await app.inject({ method: "POST", url: "/v1/qa", headers: { "content-type": type }, payload });
    assert.equal(response.statusCode, status);
    assert.equal(response.json().code, code);
    assert.ok(!response.payload.includes("PRIVATE_SENTINEL"));
  }
});

test("framework allowlist does not relay arbitrary dependency status codes or messages", () => {
  assert.equal(frameworkRequestFailure({ statusCode: 415, message: "PRIVATE_SENTINEL" }), undefined);
  assert.equal(frameworkRequestFailure({ code: "provider_failed", statusCode: 429 }), undefined);
  for (const code of ["FST_REQ_FILE_TOO_LARGE", "FST_FILES_LIMIT", "FST_FIELDS_LIMIT", "FST_PARTS_LIMIT"])
    assert.equal(frameworkRequestFailure({ code })?.status, 413);
});

test("actual multipart file limits return 413 before upload admission", async (t) => {
  const { app } = await fixture(t);
  const boundary = "lumora-fixture-boundary";
  const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fixture.txt"\r\nContent-Type: text/plain\r\n\r\n${"PRIVATE_SENTINEL".repeat(150)}\r\n--${boundary}--\r\n`;
  const response = await app.inject({ method: "POST", url: "/v1/admin/uploads", payload,
    headers: { authorization: "Bearer fixture-user", "x-workspace-id": workspaceId, "content-type": `multipart/form-data; boundary=${boundary}` } });
  assert.equal(response.statusCode, 413);
  assert.equal(response.json().code, "request_too_large");
  assert.ok(!response.payload.includes("PRIVATE_SENTINEL"));
});

test("native rate limiting retains 429 and Retry-After", async (t) => {
  const { app } = await fixture(t, { max: 1 });
  assert.equal((await app.inject("/health")).statusCode, 200);
  const response = await app.inject("/health");
  assert.equal(response.statusCode, 429);
  assert.equal(response.json().code, "rate_limit_exceeded");
  assert.ok(response.headers["retry-after"]);
});

test("only the workspace slug constraint becomes a conflict; dependency outages stay sanitized", async (t) => {
  for (const [error, expected] of [
    [Object.assign(new Error("PRIVATE_SENTINEL"), { code: "23505", constraint: "tenants_slug_key" }), 409],
    [Object.assign(new Error("PRIVATE_SENTINEL"), { code: "23505", constraint: "tenant_memberships_pkey" }), 500],
    [Object.assign(new Error("PRIVATE_SENTINEL"), { statusCode: 400 }), 500],
  ] as const) {
    await t.test(`status ${expected}, ${"constraint" in error ? error.constraint : "unclassified failure"}`, async (t) => {
      const { app } = await fixture(t, { workspaceFailure: error });
      const response = await app.inject({ method: "POST", url: "/v1/workspaces", headers: { authorization: "Bearer fixture-user" }, payload: { name: "Team", slug: "team" } });
      assert.equal(response.statusCode, expected);
      assert.ok(!response.payload.includes("PRIVATE_SENTINEL"));
    });
  }
});

test("standard Fetch JSON headers reach the real role parser and owner authorization", async (t) => {
  const { app, changeRole } = await fixture(t);
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  const url = `${base}/v1/workspaces/${workspaceId}/members/${userId}`;
  const headers = { authorization: "Bearer fixture-user", "x-workspace-id": workspaceId };
  const plain = await fetch(url, { method: "PATCH", headers, body: JSON.stringify({ role: "viewer" }) });
  assert.equal(plain.status, 400);
  assert.equal(changeRole.mock.callCount(), 0);
  const json = await fetch(url, { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ role: "viewer" }) });
  assert.equal(json.status, 204);
  assert.deepEqual(changeRole.mock.calls[0]?.arguments, [{ tenantId: workspaceId, userId, role: "viewer" }]);
});
