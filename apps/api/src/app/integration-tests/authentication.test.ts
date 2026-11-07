import assert from "node:assert/strict";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import test, { type TestContext } from "node:test";
import { config } from "../../config.js";
import { buildApp } from "../http-server.js";
import { RequestIdentity } from "../../modules/identity/http/request-identity.js";

const authUrl = "https://authentication.example.test";
const actorId = "10000000-0000-4000-8000-000000000001";
const lateMember = "10000000-0000-4000-8000-000000001004";
const unrelated = "10000000-0000-4000-8000-000000009999";
const tenantId = "20000000-0000-4000-8000-000000000001";
const otherTenant = "20000000-0000-4000-8000-000000000002";
const headers = { authorization: "Bearer session", "x-workspace-id": tenantId };
const membership = { tenantId, tenantName: "Fixture", tenantSlug: "fixture", role: "owner" as const };
const createdAt = new Date("2026-01-01T00:00:00.000Z");

function configure(t: TestContext, timeoutMs = 1000) {
  const overrides = { SUPABASE_URL: authUrl, SUPABASE_PUBLISHABLE_KEY: "public-fixture", SUPABASE_SERVICE_ROLE_KEY: "admin-fixture", API_KEY: undefined, PROVIDER_TIMEOUT_MS: timeoutMs };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, config[key as keyof typeof config]]));
  Object.assign(config, overrides);
  t.after(() => { Object.assign(config, previous); });
}

async function appFixture(t: TestContext, overrides: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const listMemberships = t.mock.fn(async () => [membership]);
  const findMembership = t.mock.fn(async () => membership);
  const listDocuments = t.mock.fn(async () => []);
  const listWorkspaceMembers = t.mock.fn(async () => [{ userId: actorId, role: "owner" as const, createdAt }]);
  const app = await buildApp({ listMemberships, findMembership, listDocuments, listWorkspaceMembers, ...overrides } as Parameters<typeof buildApp>[0]);
  t.after(() => app.close());
  return { app, listMemberships, findMembership, listDocuments, listWorkspaceMembers };
}

test("a principal is verified once inside a request and revalidated for every new request", async (t) => {
  let valid = true;
  const verify = t.mock.fn(async (token: string) => valid ? { ok: true as const, userId: token } : { ok: false as const, reason: "invalid_session" as const });
  const identity = new RequestIdentity({ verify });
  const request = { headers: { authorization: "Bearer fixture" } };
  assert.deepEqual(await Promise.all([identity.verify(request), identity.verify(request)]), [{ ok: true, userId: "fixture" }, { ok: true, userId: "fixture" }]);
  assert.equal(verify.mock.callCount(), 1);
  valid = false;
  assert.deepEqual(await identity.verify({ headers: { ...request.headers } }), { ok: false, reason: "invalid_session" });
  assert.equal(verify.mock.callCount(), 2);
});

test("request disconnection cancels verification and removes request listeners", async () => {
  const raw = new IncomingMessage(new Socket());
  const identity = new RequestIdentity({ verify: async (_token, signal) => new Promise((resolve) => signal!.addEventListener("abort", () => resolve({ ok: false, reason: "cancelled" }), { once: true })) });
  const pending = identity.verify({ headers: { authorization: "Bearer fixture" }, raw });
  raw.emit("aborted");
  assert.deepEqual(await pending, { ok: false, reason: "cancelled" });
  assert.equal(raw.listenerCount("aborted"), 0);
  assert.equal(raw.socket.listenerCount("close"), 0);
  raw.destroy();
});

test("invalid and missing sessions never reach memberships, workspace creation or the directory", async (t) => {
  configure(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ message: "PRIVATE_INVALID_SESSION_SENTINEL", code: "session_not_found" }, { status: 401 }));
  const createWorkspace = t.mock.fn(async () => membership);
  const { app, listMemberships, findMembership, listWorkspaceMembers } = await appFixture(t, { createWorkspace });
  assert.equal((await app.inject({ url: "/v1/workspaces" })).statusCode, 401);
  for (const request of [
    { method: "GET" as const, url: "/v1/workspaces" },
    { method: "POST" as const, url: "/v1/workspaces", payload: { name: "Fixture", slug: "fixture" } },
    { method: "GET" as const, url: `/v1/workspaces/${tenantId}/members` },
  ]) {
    const response = await app.inject({ ...request, headers });
    assert.equal(response.statusCode, 403);
    assert.ok(!response.body.includes("PRIVATE_"));
  }
  assert.equal(fetch.mock.callCount(), 3);
  for (const mock of [listMemberships, findMembership, listWorkspaceMembers, createWorkspace]) assert.equal(mock.mock.callCount(), 0);
});

test("valid identity never caches a revoked database membership or a downgraded role", async (t) => {
  configure(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ id: actorId, user_metadata: { tenantId, role: "owner" } }));
  let role: "owner" | "viewer" | null = "owner";
  const findMembership = t.mock.fn(async () => role ? { ...membership, role } : null);
  const { app, listDocuments, listWorkspaceMembers } = await appFixture(t, { findMembership });
  assert.equal((await app.inject({ url: "/v1/admin/documents", headers })).statusCode, 200);
  role = "viewer";
  assert.equal((await app.inject({ url: `/v1/workspaces/${tenantId}/members`, headers })).statusCode, 403);
  role = null;
  assert.equal((await app.inject({ url: "/v1/admin/documents", headers })).statusCode, 403);
  assert.equal(fetch.mock.callCount(), 3);
  assert.equal(findMembership.mock.callCount(), 3);
  assert.equal(listDocuments.mock.callCount(), 1);
  assert.equal(listWorkspaceMembers.mock.callCount(), 0);
});

test("member directory starts with selected-tenant membership IDs and can load users beyond the first thousand", async (t) => {
  configure(t);
  const order: string[] = [];
  const fetched: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const path = new URL(String(input)).pathname;
    if (path === "/auth/v1/user") { order.push("identity"); return Response.json({ id: actorId }); }
    const userId = path.split("/").at(-1)!;
    assert.ok([actorId, lateMember].includes(userId));
    assert.equal(path, `/auth/v1/admin/users/${userId}`);
    fetched.push(userId); order.push("directory");
    return Response.json({ id: userId, email: userId === actorId ? "owner@example.test" : "late@example.test", app_metadata: { unrelated, private: "PRIVATE_DIRECTORY_SENTINEL" } });
  });
  const members = [{ userId: actorId, role: "owner" as const, createdAt }, { userId: lateMember, role: "viewer" as const, createdAt }];
  const listWorkspaceMembers = t.mock.fn(async (workspaceId: string) => { assert.equal(workspaceId, tenantId); order.push("memberships"); return members; });
  const { app } = await appFixture(t, { listWorkspaceMembers });
  const response = await app.inject({ url: `/v1/workspaces/${tenantId}/members`, headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { members: members.map((member) => ({ ...member, email: member.userId === actorId ? "owner@example.test" : "late@example.test", createdAt: createdAt.toISOString() })) });
  assert.deepEqual(order, ["identity", "memberships", "directory", "directory"]);
  assert.deepEqual(fetched, [actorId, lateMember]);
  assert.ok(!response.body.includes("PRIVATE_") && !response.body.includes(unrelated));
  const mismatch = await app.inject({ url: `/v1/workspaces/${otherTenant}/members`, headers });
  assert.equal(mismatch.statusCode, 403);
  assert.equal(listWorkspaceMembers.mock.callCount(), 1);
  assert.equal(fetched.length, 2);
});

test("stalled Auth yields a safe bounded failure before any private data query", async (t) => {
  configure(t, 20);
  let aborted = false;
  t.mock.method(globalThis, "fetch", async (_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => { aborted = true; reject(new Error("PRIVATE_TRANSPORT_SENTINEL")); }, { once: true });
  }));
  const { app, listMemberships, findMembership } = await appFixture(t);
  let guard!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => { guard = setTimeout(() => reject(new Error("Authentication request was not bounded.")), 1500); });
  try {
    const response = await Promise.race([app.inject({ url: "/v1/workspaces", headers }), timeout]);
    assert.equal(response.statusCode, 504);
    assert.equal(response.json().code, "authentication_timeout");
    assert.ok(!response.body.includes("PRIVATE_"));
    assert.equal(aborted, true);
    assert.equal(listMemberships.mock.callCount(), 0);
    assert.equal(findMembership.mock.callCount(), 0);
  } finally { clearTimeout(guard); }
});

test("member identity failures preserve safe HTTP errors and removed identities remain nullable", async (t) => {
  configure(t);
  let status = 503;
  t.mock.method(globalThis, "fetch", async (input: string) => new URL(String(input)).pathname === "/auth/v1/user"
    ? Response.json({ id: actorId })
    : Response.json({ message: "PRIVATE_DIRECTORY_FAILURE_SENTINEL" }, { status }));
  const { app } = await appFixture(t);
  const unavailable = await app.inject({ url: `/v1/workspaces/${tenantId}/members`, headers });
  assert.equal(unavailable.statusCode, 502);
  assert.deepEqual(unavailable.json(), { code: "directory_unavailable", error: "Unable to load workspace members." });
  assert.ok(!unavailable.body.includes("PRIVATE_"));
  status = 404;
  const removed = await app.inject({ url: `/v1/workspaces/${tenantId}/members`, headers });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removed.json(), { members: [{ userId: actorId, role: "owner", createdAt: createdAt.toISOString(), email: null }] });
});
