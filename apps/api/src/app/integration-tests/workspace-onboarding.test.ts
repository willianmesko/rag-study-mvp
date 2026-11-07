import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { WorkspaceOnboardingProgress } from "@rag-study/contracts";
import type { WorkspaceOnboardingScope } from "../../modules/workspaces/application/ports/workspace-onboarding-repository.js";
import { config } from "../../config.js";
import { buildApp } from "../http-server.js";

const authUrl = "https://guide.example.test";
const primary = "78f3dc21-ad30-4753-be9c-5e9d32e2135f";
const secondary = "7ab25861-e3ef-44be-8058-5aad76ffab96";
const actor = "a28671d0-01c3-4da5-9fd6-213e8b5fe2d2";
const peer = "88d9b4d7-d262-4c91-b515-77f7d108fa1e";
const completed: WorkspaceOnboardingProgress = { goal: "legal", step: "answer", completed: true };

const url = (workspaceId = primary) => `/v1/workspaces/${workspaceId}/onboarding`;
const headers = (session = "actor-a", workspaceId = primary) => ({ authorization: `Bearer ${session}`, "x-workspace-id": workspaceId });

async function fixture(t: TestContext) {
  const previous = { SUPABASE_URL: config.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: config.SUPABASE_PUBLISHABLE_KEY, API_KEY: config.API_KEY };
  Object.assign(config, { SUPABASE_URL: authUrl, SUPABASE_PUBLISHABLE_KEY: "fixture-key", API_KEY: undefined });
  t.after(() => { Object.assign(config, previous); });
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    assert.equal(String(input), `${authUrl}/auth/v1/user`);
    const authorization = new Headers(init?.headers).get("authorization");
    if (!["Bearer actor-a", "Bearer actor-b", "Bearer peer"].includes(authorization ?? "")) {
      return Response.json({ message: "Invalid token" }, { status: 401 });
    }
    return Response.json({ id: authorization === "Bearer peer" ? peer : actor, aud: "authenticated", role: "authenticated" });
  });
  const records = new Map<string, WorkspaceOnboardingProgress>();
  const get = t.mock.fn(async ({ tenantId, userId }: WorkspaceOnboardingScope) => records.get(`${tenantId}:${userId}`) ?? null);
  const save = t.mock.fn(async ({ tenantId, userId }: WorkspaceOnboardingScope, progress: WorkspaceOnboardingProgress) => {
    records.set(`${tenantId}:${userId}`, progress);
    return progress;
  });
  const app = await buildApp({
    workspaceOnboarding: { get, save },
    findMembership: async (userId: string, tenantId: string) => tenantId === primary || (tenantId === secondary && userId === actor)
      ? { tenantId, tenantName: "Guide fixture", tenantSlug: "guide-fixture", role: "viewer" } : null
  } as unknown as Parameters<typeof buildApp>[0]);
  t.after(() => app.close());
  return { app, get, save };
}

test("the same account resumes its viewer guide from another session and only in its workspace", async (t) => {
  const { app, save } = await fixture(t);
  const empty = await app.inject({ method: "GET", url: url(), headers: headers() });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json(), { progress: null });
  const patch = await app.inject({ method: "PATCH", url: url(), headers: headers(), payload: completed });
  assert.equal(patch.statusCode, 200);
  assert.deepEqual(save.mock.calls[0]?.arguments, [{ tenantId: primary, userId: actor }, completed]);
  for (const [requestHeaders, workspaceId, expected] of [
    [headers("actor-b"), primary, completed],
    [headers("peer"), primary, null],
    [headers("actor-b", secondary), secondary, null]
  ] as const) {
    const response = await app.inject({ method: "GET", url: url(workspaceId), headers: requestHeaders });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { progress: expected });
  }
});

test("onboarding saves and resumes generic goals while accepting earlier selections", async (t) => {
  const { app } = await fixture(t);
  for (const goal of ["knowledge", "support", "learning", "legal", "it", "custom"] as const) {
    const progress = { goal, step: "knowledge", completed: false } as const;
    const patch = await app.inject({ method: "PATCH", url: url(), headers: headers(), payload: progress });
    assert.equal(patch.statusCode, 200);
    assert.deepEqual(patch.json(), { progress });
    const read = await app.inject({ method: "GET", url: url(), headers: headers("actor-b") });
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json(), { progress });
  }
});

test("onboarding rejects unauthenticated, mismatched, and unowned workspace scope", async (t) => {
  const { app, get, save } = await fixture(t);
  const attempts = [
    { requestHeaders: {}, endpoint: url(), status: 401 },
    { requestHeaders: { authorization: "Bearer actor-a" }, endpoint: url(), status: 400 },
    { requestHeaders: headers("actor-a", secondary), endpoint: url(), status: 403 },
    { requestHeaders: headers("peer", secondary), endpoint: url(secondary), status: 403 }
  ];
  for (const { requestHeaders, endpoint, status } of attempts) {
    const read = await app.inject({ method: "GET", url: endpoint, headers: requestHeaders });
    const write = await app.inject({ method: "PATCH", url: endpoint, headers: requestHeaders, payload: completed });
    assert.equal(read.statusCode, status);
    assert.equal(write.statusCode, status);
  }
  assert.equal(get.mock.callCount(), 0);
  assert.equal(save.mock.callCount(), 0);
});

test("onboarding payload cannot name an actor or mark an early step complete", async (t) => {
  const { app, save } = await fixture(t);
  for (const payload of [
    { ...completed, userId: peer },
    { ...completed, step: "knowledge" },
    { ...completed, goal: null },
    { ...completed, goal: "unknown" }
  ]) {
    const response = await app.inject({ method: "PATCH", url: url(), headers: headers(), payload });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(save.mock.callCount(), 0);
});
