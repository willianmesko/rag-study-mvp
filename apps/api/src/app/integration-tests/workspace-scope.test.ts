import {InviteWorkspaceMember,InvitationDeliveryError} from '../../modules/workspaces/application/integrations/workspace-invitations.js';
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { TenantMembership } from "../../modules/workspaces/application/ports/tenant-membership-repository.js";
import type { AnswerQuestionUseCase } from "../../modules/chat/application/use-cases/answer-question.js";
import { config } from "../../config.js";
import type { RetrievedChunk } from "../../modules/knowledge/domain/document.js";
import { buildApp } from "../http-server.js";

const supabaseUrl = "https://supabase.example.test";
const actorId = "bd129ffe-fc9b-4174-ade4-d6dd673ae2d3";
const foreignWorkspaceId = "77fe84c4-99f8-4efc-b54c-6a21a666d10f";
const ti: TenantMembership = { tenantId: "78f3dc21-ad30-4753-be9c-5e9d32e2135f", tenantName: "TI", tenantSlug: "ti", role: "owner" };
const legal: TenantMembership = { tenantId: "7ab25861-e3ef-44be-8058-5aad76ffab96", tenantName: "Legal", tenantSlug: "legal", role: "viewer" };
const authorization = { authorization: "Bearer fixture-workspace-user" };
const headersFor = (tenantId: string) => ({ ...authorization, "x-workspace-id": tenantId });
const question = "What is the approval policy?";
const createdAt = new Date("2026-01-01T00:00:00Z");
const security: RetrievedChunk["security"] = { promptInjectionRisk: "low", signals: [] };
const tiSource: RetrievedChunk = {
  chunkId: "87336cef-d267-4de9-86ee-41a451cbb827", documentId: "395f0220-375a-469c-aace-458b079f6686",
  ordinal: 0, content: "The infrastructure lead reviews changes.", source: "it-policy.md",
  title: "TI policy", score: 0.85, security
};
const legalSource: RetrievedChunk = {
  chunkId: "a348491a-9a64-4536-a55f-a047d174beeb", documentId: "36f1942b-c98e-4bb2-beed-792f931fdaab",
  ordinal: 0, content: "The legal lead reviews new agreements.", source: "legal-policy.md",
  title: "Legal policy", score: 0.82, security
};
const sources = new Map([[ti.tenantId, tiSource], [legal.tenantId, legalSource]]);

async function fixture(t: TestContext, memberships: TenantMembership[] = [ti, legal]) {
  const overrides = {
    SUPABASE_URL: supabaseUrl, SUPABASE_PUBLISHABLE_KEY: "fixture-publishable-key",
    API_KEY: undefined, DEMO_MODE: true, RATE_LIMIT_MAX: 60, QA_RATE_LIMIT_MAX: 20
  };
  const original = Object.fromEntries(Object.keys(overrides).map((key) => [key, config[key as keyof typeof config]]));
  Object.assign(config, overrides);
  t.after(() => { Object.assign(config, original); });

  const getUser = t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    assert.equal(String(url), `${supabaseUrl}/auth/v1/user`);
    assert.equal(new Headers(init?.headers).get("authorization"), authorization.authorization);
    return Response.json({
      id: actorId, aud: "authenticated", role: "authenticated",
      user_metadata: { tenantId: foreignWorkspaceId, role: "owner" }
    });
  });
  const listMemberships = t.mock.fn(async (userId: string, limit?: number) =>
    userId === actorId ? memberships.slice(0, limit ?? memberships.length) : []
  );
  const findMembership = t.mock.fn(async (userId: string, tenantId: string) =>
    userId === actorId ? memberships.find((membership) => membership.tenantId === tenantId) ?? null : null
  );
  const search = t.mock.fn(async ({ tenantId }: { query: string; tenantId: string }) => {
    const source = sources.get(tenantId);
    return source ? [source] : [];
  });
  const answer = t.mock.fn(async ({ tenantId }: Parameters<AnswerQuestionUseCase["execute"]>[0]) => {
    const source = sources.get(tenantId);
    assert.ok(source);
    return { answer: source.content, sources: [source], citedChunkIds: [source.chunkId] };
  });
  const listDocuments = t.mock.fn(async (tenantId: string) => {
    const source = sources.get(tenantId);
    return source ? [{
      id: source.documentId, source: source.source, title: source.title, chunkCount: 1, hasOriginal: false, createdAt, updatedAt: createdAt
    }] : [];
  });
  const listDocumentChunks = t.mock.fn(async (tenantId: string, documentId: string) => {
    const source = sources.get(tenantId);
    return source?.documentId === documentId ? [{
      id: source.chunkId, ordinal: source.ordinal, content: source.content, security: source.security, createdAt
    }] : [];
  });
  const deleteDocument = t.mock.fn(async ({ tenantId, documentId }: { tenantId: string; documentId: string }) =>
    sources.get(tenantId)?.documentId === documentId
  );
  const changeWorkspaceMemberRole = t.mock.fn(async () => true);
  const invalidateSemanticCache = t.mock.fn(async (_tenantId: string) => {});
  const consumeQuestionQuota = t.mock.fn(async (_tenantId: string, _actorKey: string) => ({ allowed: true, used: 1, limit: 100 }));
  const createWorkspace = t.mock.fn(async (input: { userId: string; name: string; slug: string }) => ({
    tenantId: foreignWorkspaceId, tenantName: input.name, tenantSlug: input.slug, role: "owner" as const
  }));

  const app = await buildApp({
    listMemberships, findMembership, listDocuments, listDocumentChunks, invalidateSemanticCache,
    consumeQuestionQuota, changeWorkspaceMemberRole, createWorkspace,
    searchDocuments: { execute: search }, answerQuestion: { execute: answer }, deleteDocument: { execute: deleteDocument },
    recordAuditEvent: async () => {}
  } as unknown as Parameters<typeof buildApp>[0]);
  t.after(() => app.close());
  return { app, getUser, listMemberships, findMembership, search, answer, listDocuments, listDocumentChunks,
    consumeQuestionQuota, deleteDocument, changeWorkspaceMemberRole, invalidateSemanticCache, createWorkspace };
}

test("workspace discovery returns every membership and its own role without a selected workspace", async (t) => {
  const { app, listMemberships, findMembership } = await fixture(t);
  const response = await app.inject({ method: "GET", url: "/v1/workspaces", headers: authorization });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { workspaces: [ti, legal] });
  assert.deepEqual(listMemberships.mock.calls[0]?.arguments, [actorId]);
  assert.equal(findMembership.mock.callCount(), 0);
});

test("the same search and question only return the selected workspace's sources", async (t) => {
  const { app, listMemberships, search, answer, consumeQuestionQuota } = await fixture(t);
  for (const [workspace, source] of [[ti, tiSource], [legal, legalSource]] as const) {
    const headers = headersFor(workspace.tenantId);
    const query = await app.inject({ method: "GET", url: `/v1/search?q=${encodeURIComponent(question)}`, headers });
    assert.equal(query.statusCode, 200);
    assert.deepEqual(query.json().results.map((result: RetrievedChunk) => result.source), [source.source]);

    const response = await app.inject({ method: "POST", url: "/v1/qa", headers, payload: { question } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().answer, source.content);
    assert.deepEqual(response.json().citedChunkIds, [source.chunkId]);

    const streamed = await app.inject({ method: "POST", url: "/v1/qa/stream", headers, payload: { question } });
    assert.equal(streamed.statusCode, 200);
    const completion = streamed.body.match(/^event: completed\ndata: (.+)$/m)?.[1];
    assert.ok(completion);
    assert.deepEqual(JSON.parse(completion).citedChunkIds, [source.chunkId]);
  }
  assert.equal(listMemberships.mock.callCount(), 0);
  assert.deepEqual(search.mock.calls.map((call) => call.arguments[0].tenantId), [ti.tenantId, legal.tenantId]);
  const expectedScopes = [ti.tenantId, ti.tenantId, legal.tenantId, legal.tenantId];
  assert.deepEqual(answer.mock.calls.map((call) => call.arguments[0].tenantId), expectedScopes);
  assert.deepEqual(consumeQuestionQuota.mock.calls.map((call) => call.arguments), expectedScopes.map((id) => [id, `user:${actorId}`]));
});

test("multiple memberships require a selection before corpus reads, generation, or quota", async (t) => {
  const { app, listMemberships, findMembership, search, answer, listDocuments, consumeQuestionQuota } = await fixture(t);
  const headers = authorization;
  for (const response of [
    await app.inject({ method: "GET", url: "/v1/search?q=policy", headers }),
    await app.inject({ method: "POST", url: "/v1/qa", headers, payload: { question } }),
    await app.inject({ method: "POST", url: "/v1/qa/stream", headers, payload: { question } }),
    await app.inject({ method: "GET", url: "/v1/admin/documents", headers })
  ]) {
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, "workspace_required");
  }
  assert.deepEqual(listMemberships.mock.calls.map((call) => call.arguments), Array.from({ length: 4 }, () => [actorId, 2]));
  assert.equal(findMembership.mock.callCount(), 0);
  assert.equal(search.mock.callCount(), 0);
  assert.equal(answer.mock.callCount(), 0);
  assert.equal(listDocuments.mock.callCount(), 0);
  assert.equal(consumeQuestionQuota.mock.callCount(), 0);
});

test("one membership can be used without a header on compatible endpoints", async (t) => {
  const { app, listMemberships, findMembership } = await fixture(t, [legal]);
  const response = await app.inject({ method: "POST", url: "/v1/qa", headers: authorization, payload: { question } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().citedChunkIds, [legalSource.chunkId]);
  const documents = await app.inject({ method: "GET", url: "/v1/admin/documents", headers: authorization });
  assert.equal(documents.statusCode, 200);
  assert.deepEqual(documents.json().documents.map((document: { id: string }) => document.id), [legalSource.documentId]);
  assert.deepEqual(listMemberships.mock.calls.map((call) => call.arguments), [[actorId, 2], [actorId, 2]]);
  assert.equal(findMembership.mock.callCount(), 0);
});

test("malformed or duplicated workspace headers are rejected before looking up a membership", async (t) => {
  const { app, getUser, listMemberships, findMembership, consumeQuestionQuota } = await fixture(t, [ti]);
  for (const workspace of ["", "not-a-uuid", `${ti.tenantId}, ${legal.tenantId}`, [ti.tenantId, ti.tenantId]]) {
    const response = await app.inject({
      method: "POST", url: "/v1/qa", headers: { ...authorization, "x-workspace-id": workspace }, payload: { question }
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, "invalid_workspace");
  }
  assert.equal(getUser.mock.callCount(), 0);
  assert.equal(listMemberships.mock.callCount(), 0);
  assert.equal(findMembership.mock.callCount(), 0);
  assert.equal(consumeQuestionQuota.mock.callCount(), 0);
});

test("a workspace UUID outside the user's memberships cannot use the demo or another workspace", async (t) => {
  const { app, listMemberships, findMembership, answer, consumeQuestionQuota } = await fixture(t);
  const response = await app.inject({
    method: "POST", url: "/v1/qa", headers: headersFor(foreignWorkspaceId), payload: { question }
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(findMembership.mock.calls[0]?.arguments, [actorId, foreignWorkspaceId]);
  assert.equal(listMemberships.mock.callCount(), 0);
  assert.equal(answer.mock.callCount(), 0);
  assert.equal(consumeQuestionQuota.mock.callCount(), 0);
});

test("document and team access are checked against the selected workspace and role", async (t) => {
  const { app, listDocumentChunks, deleteDocument, changeWorkspaceMemberRole, invalidateSemanticCache } = await fixture(t);
  const tiHeaders = headersFor(ti.tenantId);
  const legalHeaders = headersFor(legal.tenantId);
  const legalDocumentUrl = `/v1/admin/documents/${legalSource.documentId}`;
  const crossTenantChunks = await app.inject({ method: "GET", url: legalDocumentUrl + "/chunks", headers: tiHeaders });
  assert.equal(crossTenantChunks.statusCode, 200);
  assert.deepEqual(crossTenantChunks.json(), { chunks: [] });
  assert.deepEqual(listDocumentChunks.mock.calls[0]?.arguments, [ti.tenantId, legalSource.documentId, 200]);
  assert.equal((await app.inject({ method: "DELETE", url: legalDocumentUrl, headers: tiHeaders })).statusCode, 404);
  assert.equal((await app.inject({ method: "DELETE", url: legalDocumentUrl, headers: legalHeaders })).statusCode, 403);
  assert.deepEqual(deleteDocument.mock.calls.map((call) => call.arguments), [[{ documentId: legalSource.documentId, tenantId: ti.tenantId }]]);

  for (const headers of [tiHeaders, legalHeaders]) {
    const response = await app.inject({
      method: "PATCH", url: `/v1/workspaces/${legal.tenantId}/members/${actorId}`, headers, payload: { role: "editor" }
    });
    assert.equal(response.statusCode, 403);
  }
  assert.equal(changeWorkspaceMemberRole.mock.callCount(), 0);
  const ownDelete = await app.inject({ method: "DELETE", url: `/v1/admin/documents/${tiSource.documentId}`, headers: tiHeaders });
  assert.equal(ownDelete.statusCode, 204);
  assert.deepEqual(invalidateSemanticCache.mock.calls[0]?.arguments, [ti.tenantId]);
});

test("an authenticated user without memberships can create a workspace but cannot query a corpus", async (t) => {
  const { app, search, createWorkspace } = await fixture(t, []);
  const noMembership = await app.inject({ method: "GET", url: "/v1/search?q=policy", headers: authorization });
  assert.equal(noMembership.statusCode, 403);
  assert.equal(search.mock.callCount(), 0);

  const created = await app.inject({
    method: "POST", url: "/v1/workspaces", headers: authorization, payload: { name: " Compliance ", slug: "Compliance-Team" }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().workspace.role, "owner");
  assert.deepEqual(createWorkspace.mock.calls[0]?.arguments, [{ userId: actorId, name: "Compliance", slug: "compliance-team" }]);
});

test("an invitation cannot update an existing membership or record a successful invite", async (t) => {
  const auth = { SUPABASE_URL: supabaseUrl, SUPABASE_PUBLISHABLE_KEY: "fixture-publishable-key",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key", APP_BASE_URL: "https://lumora.example.test", API_KEY: undefined };
  const previous = Object.fromEntries(Object.keys(auth).map((key) => [key, config[key as keyof typeof config]]));
  Object.assign(config, auth);
  t.after(() => { Object.assign(config, previous); });
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const pathname = new URL(url).pathname;
    assert.ok(pathname === "/auth/v1/user" || pathname === "/auth/v1/invite");
    return Response.json({ id: actorId, aud: "authenticated", role: "authenticated" });
  });
  const begin=t.mock.fn(async(input:{tenantId:string;actorId:string})=>{assert.equal(input.tenantId,ti.tenantId);assert.equal(input.actorId,actorId);throw new InvitationDeliveryError('already_member');});
  const send=t.mock.fn(async()=>actorId);
  const complete=t.mock.fn(async()=>({userId:actorId,email:'existing@example.test',role:'viewer' as const}));
  const recordAuditEvent = t.mock.fn(async () => {});
  const inviteWorkspaceMember=new InviteWorkspaceMember({begin,complete,fail:async()=>{}},{send});
  const app = await buildApp({
    findMembership: async () => ti, inviteWorkspaceMember, recordAuditEvent
  } as unknown as Parameters<typeof buildApp>[0]);
  t.after(() => app.close());

  const response = await app.inject({ method: "POST", url: `/v1/workspaces/${ti.tenantId}/invitations`,
    headers: headersFor(ti.tenantId), payload: { email: "existing@example.test", role: "viewer" } });
  assert.equal(response.statusCode, 409);
  assert.equal(begin.mock.callCount(),1);
  assert.equal(send.mock.callCount(),0);
  assert.equal(complete.mock.callCount(),0);
  assert.equal(recordAuditEvent.mock.callCount(), 0);
});
