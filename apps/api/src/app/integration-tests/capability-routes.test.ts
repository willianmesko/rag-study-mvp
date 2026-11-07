import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { workspaceRoutes, type WorkspaceRoutesDependencies } from "../../modules/workspaces/workspaces.controller.js";
import { workspaceTeamRoutes, type WorkspaceTeamRoutesDependencies } from "../../modules/workspaces/workspace-team.controller.js";
import { documentRoutes, type DocumentRoutesDependencies } from "../../modules/knowledge/documents.controller.js";
import { serializeJob } from "../../modules/ingestion/http/ingestion.js";
import type { WorkspacePrincipal } from "../../platform/http/workspace-authorization.js";
import { frameworkRequestFailure } from "../../platform/http/request-errors.js";

const userId = "10000000-0000-4000-8000-000000000001";
const tenantId = "20000000-0000-4000-8000-000000000001";
const otherTenant = "20000000-0000-4000-8000-000000000002";
const documentId = "30000000-0000-4000-8000-000000000001";
const actor: WorkspacePrincipal = { ok: true, userId, tenantId, role: "owner" };
const membership = { tenantId, tenantName: "Workspace", tenantSlug: "workspace", role: "owner" as const };
const createdAt = new Date("2026-01-01T00:00:00.000Z");

async function fixture(t: TestContext, max = 100) {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max, timeWindow: 60_000, errorResponseBuilder: (_request, context) => ({ statusCode: context.statusCode, code: "rate_limit_exceeded", error: "Too many requests. Try again later." }) });
  app.addHook("onSend", async (_request, reply, payload) => { reply.header("x-parent-hook", "applied"); return payload; });
  app.setErrorHandler((error, _request, reply) => {
    const failure = frameworkRequestFailure(error);
    return failure ? reply.code(failure.status).send(failure.body) : reply.code(error instanceof ZodError ? 400 : 500).send({ error: "Parent handled request failure." });
  });
  t.after(() => app.close());
  return app;
}

function workspaceDependencies(): WorkspaceRoutesDependencies {
  return {
    authorizeUser: async () => ({ ok: true, userId }), authorizeMember: async () => actor,
    listMemberships: async () => [membership], createWorkspace: async () => membership,
    workspaceOnboarding: { get: async () => null, save: async (_scope, progress) => progress },
  };
}

function teamDependencies(): WorkspaceTeamRoutesDependencies {
  return {
    authorizeOwner: async () => actor,
    memberDirectory: { emailsForMembers: async () => new Map([[userId, "owner@example.test"]]) },
    listWorkspaceMembers: async () => [{ userId, role: "owner", createdAt }],
    changeWorkspaceMemberRole: async () => false, removeWorkspaceMember: async () => false,
    isMemberDirectoryConfigured: () => true, isInvitationConfigured: () => true,
    shutdown: new AbortController().signal,
  };
}

function documentDependencies(): DocumentRoutesDependencies {
  return {
    authorizeMember: async () => actor, authorizeAdmin: async () => actor,
    listDocuments: async () => [], listDocumentChunks: async () => [],
    getDocumentOriginal: { execute: async () => null }, reindexDocument: { execute: async () => null }, deleteDocument: { execute: async () => false },
    serializeReindexJob: serializeJob,
    invalidateSemanticCache: async () => {}, recordAuditEvent: async () => {},
  };
}

test("the parent global rate limit remains shared across independently registered capability plugins", async (t) => {
  const app = await fixture(t, 2);
  app.register(workspaceRoutes, workspaceDependencies());
  app.register(workspaceTeamRoutes, teamDependencies());
  app.register(documentRoutes, documentDependencies());
  assert.equal((await app.inject("/v1/workspaces")).statusCode, 200);
  assert.equal((await app.inject(`/v1/workspaces/${tenantId}/members`)).statusCode, 200);
  const limited = await app.inject("/v1/admin/documents");
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().code, "rate_limit_exceeded");
  assert.ok(limited.headers["retry-after"]);
});

test("workspace plugin needs only its own ports and inherits parent hooks and validation handling", async (t) => {
  const app = await fixture(t);
  const createWorkspace = t.mock.fn(async (input: Parameters<WorkspaceRoutesDependencies["createWorkspace"]>[0]) => ({ ...membership, tenantName: input.name, tenantSlug: input.slug }));
  app.register(workspaceRoutes, { ...workspaceDependencies(), createWorkspace });
  const listed = await app.inject("/v1/workspaces");
  assert.deepEqual(listed.json(), { workspaces: [membership] });
  assert.equal(listed.headers["x-parent-hook"], "applied");
  const created = await app.inject({ method: "POST", url: "/v1/workspaces", payload: { name: " Example ", slug: "Example-Team", userId: "untrusted" } });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(createWorkspace.mock.calls[0].arguments, [{ userId, name: "Example", slug: "example-team" }]);
  const invalid = await app.inject({ method: "POST", url: "/v1/workspaces", payload: { name: "x", slug: "invalid slug" } });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.json(), { error: "Parent handled request failure." });
  assert.equal(createWorkspace.mock.callCount(), 1);
});

test("onboarding requires explicit authorization and prevents a route parameter from changing workspace scope", async (t) => {
  const app = await fixture(t);
  const authorizeMember = t.mock.fn<WorkspaceRoutesDependencies["authorizeMember"]>(async (_request, explicit) => { assert.equal(explicit, true); return { ...actor, role: "viewer" }; });
  const get = t.mock.fn(async () => null);
  const save = t.mock.fn<WorkspaceRoutesDependencies["workspaceOnboarding"]["save"]>(async (_scope, progress) => progress);
  app.register(workspaceRoutes, { ...workspaceDependencies(), authorizeMember, workspaceOnboarding: { get, save } });
  assert.equal((await app.inject(`/v1/workspaces/${otherTenant}/onboarding`)).statusCode, 403);
  assert.equal(get.mock.callCount(), 0);
  const progress = { goal: "knowledge", step: "knowledge", completed: false };
  const saved = await app.inject({ method: "PATCH", url: `/v1/workspaces/${tenantId}/onboarding`, payload: progress });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(save.mock.calls[0].arguments, [{ tenantId, userId }, progress]);
  assert.equal(authorizeMember.mock.callCount(), 2);
});

test("workspace creation retains a targeted slug conflict without hiding unrelated failures", async (t) => {
  const app = await fixture(t);
  let slugConflict = true;
  app.register(workspaceRoutes, { ...workspaceDependencies(), createWorkspace: async () => { throw { code: "23505", constraint: slugConflict ? "tenants_slug_key" : "other_constraint" }; } });
  const request = { method: "POST" as const, url: "/v1/workspaces", payload: { name: "Example", slug: "example" } };
  assert.equal((await app.inject(request)).statusCode, 409);
  slugConflict = false;
  assert.equal((await app.inject(request)).statusCode, 500);
});

test("team plugin performs membership-first projection and forwards cancellation without fetching global identities", async (t) => {
  const app = await fixture(t);
  const order: string[] = [];
  const dependencies = teamDependencies();
  dependencies.listWorkspaceMembers = async (workspace) => { assert.equal(workspace, tenantId); order.push("memberships"); return [{ userId, role: "owner", createdAt }]; };
  dependencies.memberDirectory = { emailsForMembers: async (ids, signal) => {
    order.push("directory"); assert.deepEqual(ids, [userId]); assert.ok(signal instanceof AbortSignal); assert.equal(signal.aborted, false);
    return new Map([[userId, "owner@example.test"]]);
  } };
  app.register(workspaceTeamRoutes, dependencies);
  const response = await app.inject(`/v1/workspaces/${tenantId}/members`);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { members: [{ userId, email: "owner@example.test", role: "owner", createdAt: createdAt.toISOString() }] });
  assert.deepEqual(order, ["memberships", "directory"]);
  assert.equal((await app.inject(`/v1/workspaces/${otherTenant}/members`)).statusCode, 403);
  assert.deepEqual(order, ["memberships", "directory"]);
});

test("team denial happens before all reads and effects, including invalid invitation bodies", async (t) => {
  const app = await fixture(t);
  const listWorkspaceMembers = t.mock.fn(async () => []);
  const changeWorkspaceMemberRole = t.mock.fn(async () => true);
  const removeWorkspaceMember = t.mock.fn(async () => true);
  const execute = t.mock.fn(async () => ({ userId, email: "person@example.test", role: "viewer" as const }));
  app.register(workspaceTeamRoutes, { ...teamDependencies(), authorizeOwner: async () => ({ ok: false, status: 403, error: "Workspace owner access required." }), listWorkspaceMembers, changeWorkspaceMemberRole, removeWorkspaceMember, inviteWorkspaceMember: { execute } });
  for (const request of [
    { method: "GET" as const, url: `/v1/workspaces/${tenantId}/members` },
    { method: "POST" as const, url: `/v1/workspaces/${tenantId}/invitations`, payload: { role: "invalid" } },
    { method: "PATCH" as const, url: `/v1/workspaces/${tenantId}/members/${userId}`, payload: { role: "viewer" } },
    { method: "DELETE" as const, url: `/v1/workspaces/${tenantId}/members/${userId}` },
  ]) assert.equal((await app.inject(request)).statusCode, 403);
  for (const mock of [listWorkspaceMembers, changeWorkspaceMemberRole, removeWorkspaceMember, execute]) assert.equal(mock.mock.callCount(), 0);
});

test("invitation plugin preserves idempotency inputs, response shape and inherited per-route rate limits", async (t) => {
  const app = await fixture(t);
  const execute = t.mock.fn(async (_input: Parameters<NonNullable<WorkspaceTeamRoutesDependencies["inviteWorkspaceMember"]>["execute"]>[0]) => ({ userId, email: "person@example.test", role: "viewer" as const }));
  app.register(workspaceTeamRoutes, { ...teamDependencies(), inviteWorkspaceMember: { execute } });
  const request = { method: "POST" as const, url: `/v1/workspaces/${tenantId}/invitations`, headers: { "idempotency-key": "invitation-fixture-key-001" }, payload: { email: "Person@example.test", role: "viewer" } };
  const response = await app.inject(request);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), { member: { userId, email: "person@example.test", role: "viewer" } });
  const input = execute.mock.calls[0].arguments[0];
  assert.equal(input.tenantId, tenantId); assert.equal(input.actorId, userId); assert.equal(input.email, "person@example.test"); assert.equal(input.idempotencyKey, "invitation-fixture-key-001");
  for (let n = 1; n < 6; n++) assert.equal((await app.inject(request)).statusCode, 201);
  assert.equal((await app.inject(request)).statusCode, 429);
  assert.equal(execute.mock.callCount(), 6);
});

test("document deletion preserves scoped effect order and leaves missing documents unchanged", async (t) => {
  const app = await fixture(t);
  const order: string[] = [];
  let exists = true;
  app.register(documentRoutes, {
    ...documentDependencies(),
    deleteDocument: { execute: async (input) => { assert.deepEqual(input, { tenantId, documentId }); if (!exists) return false; order.push("delete"); return true; } },
    invalidateSemanticCache: async (workspace) => { assert.equal(workspace, tenantId); order.push("cache"); },
    recordAuditEvent: async (event) => { assert.equal(event.tenantId, tenantId); assert.equal(event.actorUserId, userId); assert.equal(event.resourceId, documentId); order.push("audit"); },
  });
  assert.equal((await app.inject({ method: "DELETE", url: `/v1/admin/documents/${documentId}` })).statusCode, 204);
  assert.deepEqual(order, ["delete", "cache", "audit"]);
  exists = false;
  assert.equal((await app.inject({ method: "DELETE", url: `/v1/admin/documents/${documentId}` })).statusCode, 404);
  assert.deepEqual(order, ["delete", "cache", "audit"]);
});

test("reindex response uses its injected wire serializer after audit without exposing private originals", async (t) => {
  const app = await fixture(t);
  const order: string[] = [];
  const job: NonNullable<Awaited<ReturnType<DocumentRoutesDependencies["reindexDocument"]["execute"]>>> = {
    id: documentId, tenantId, documentId, source: "fixture.md", title: "Fixture", filename: "fixture.md", mimeType: "text/markdown",
    payload: Buffer.from("PRIVATE_REINDEX_ORIGINAL"), storagePath: "private/reindex-fixture", status: "queued", progress: 0,
    error: null, chunkCount: null, highRiskChunks: null, createdAt, updatedAt: createdAt,
  };
  app.register(documentRoutes, {
    ...documentDependencies(), reindexDocument: { execute: async (input) => { assert.deepEqual(input, { tenantId, documentId }); return job; } },
    recordAuditEvent: async (event) => { assert.equal(event.action, "document.reindex_queued"); order.push("audit"); },
    serializeReindexJob: (value) => { assert.equal(value, job); order.push("serialize"); return serializeJob(value); },
  });
  const response = await app.inject({ method: "POST", url: `/v1/admin/documents/${documentId}/reindex` });
  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), { job: serializeJob(job) });
  assert.deepEqual(order, ["audit", "serialize"]);
  assert.ok(!response.body.includes("PRIVATE_REINDEX_ORIGINAL") && !response.body.includes("private/reindex-fixture"));
});

test("document originals retain bounded workspace authorization, safe attachments, audit and HEAD behavior", async (t) => {
  const app = await fixture(t);
  const audit = t.mock.fn<DocumentRoutesDependencies["recordAuditEvent"]>(async () => {});
  const payload = Buffer.from("%PDF-fixture\n");
  app.register(documentRoutes, {
    ...documentDependencies(),
    authorizeMember: async (_request, explicit) => { assert.equal(explicit, true); return { ...actor, role: "viewer" }; },
    getDocumentOriginal: { execute: async (input) => { assert.deepEqual(input, { tenantId, documentId }); return { payload, mimeType: "application/pdf", filename: '../unsafe"\r\nreport.pdf' }; } },
    recordAuditEvent: audit,
  });
  const path = `/v1/admin/documents/${documentId}/original`;
  const response = await app.inject(path);
  assert.equal(response.statusCode, 200); assert.equal(response.headers["content-type"], "application/pdf");
  assert.equal(response.headers["x-parent-hook"], "applied");
  assert.match(String(response.headers["content-disposition"]), /^attachment;/);
  assert.doesNotMatch(String(response.headers["content-disposition"]), /[\r\n]/);
  assert.deepEqual(response.rawPayload, payload);
  assert.equal(audit.mock.callCount(), 1);
  assert.equal((await app.inject({ method: "HEAD", url: path })).statusCode, 404);
  assert.equal(audit.mock.callCount(), 1);
});
