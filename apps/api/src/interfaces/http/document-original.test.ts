import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { AuditEventRepository } from "../../application/ports/audit-event-repository.js";
import { config } from "../../config.js";
import type { DocumentInput } from "../../domain/document.js";
import { buildApp } from "./app.js";

const supabaseUrl = "https://supabase.example.test";
const webOrigin = "https://web.example.test";
const viewerId = "f13663f7-f255-4c24-a102-6d747bf83e60";
const workspaceId = "5a7adf27-90b7-49bf-92d8-8bbdb7ac86db";
const otherWorkspaceId = "99b6514c-7335-407a-a2d1-d51f777b0ddd";
const documentId = "2e924516-c595-4c85-8954-ae292347de06";
const missingDocumentId = "dc28a696-c341-4471-8a81-8821968019cc";
const authorization = "Bearer fixture-viewer-token";
const memberHeaders = { authorization, "x-workspace-id": workspaceId, origin: webOrigin };
const originalPath = (id: string) => `/v1/admin/documents/${id}/original`;
const pdf = { filename: "source.pdf", mimeType: "application/pdf", payload: Buffer.from("%PDF-fixture\n") };

async function fixture(t: TestContext, original = pdf) {
  const configOverrides = {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: "fixture-publishable-key",
    API_KEY: undefined,
    DEMO_MODE: true,
    ALLOWED_ORIGINS: [webOrigin],
    RATE_LIMIT_MAX: 60
  };
  const previousConfig = Object.fromEntries(Object.keys(configOverrides).map((key) => [key, config[key as keyof typeof config]]));
  Object.assign(config, configOverrides);
  t.after(() => {
    Object.assign(config, previousConfig);
  });

  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    assert.equal(String(url), `${supabaseUrl}/auth/v1/user`);
    const headers = new Headers(init?.headers);
    if (headers.get("authorization") !== authorization) {
      return Response.json({ message: "Invalid token" }, { status: 401 });
    }
    return Response.json({ id: viewerId, aud: "authenticated", role: "authenticated" });
  });

  const membership = { tenantId: workspaceId, tenantName: "Legal", tenantSlug: "legal", role: "viewer" as const };
  const listMemberships = t.mock.fn(async () => [membership]);
  const findMembership = t.mock.fn(async (userId: string, tenantId: string) =>
    userId === viewerId && tenantId === workspaceId ? membership : null
  );
  const getDocumentOriginal = t.mock.fn(async (input: { tenantId: string; documentId: string }) =>
    input.tenantId === workspaceId && input.documentId === documentId ? original : null
  );
  const recordAuditEvent = t.mock.fn(async (_input: Parameters<AuditEventRepository["record"]>[0]) => {});
  const dependencies = {
    listMemberships,
    findMembership,
    getDocumentOriginal: { execute: getDocumentOriginal },
    recordAuditEvent
  } satisfies Partial<Parameters<typeof buildApp>[0]>;
  const app = await buildApp(dependencies as unknown as Parameters<typeof buildApp>[0]);
  t.after(() => app.close());
  return { app, listMemberships, findMembership, getDocumentOriginal, recordAuditEvent };
}

test("originals require an authenticated user even in public demo mode", async (t) => {
  const { app, findMembership, getDocumentOriginal } = await fixture(t);
  const url = originalPath(documentId);
  assert.equal((await app.inject({ method: "GET", url })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url, headers: { "x-workspace-id": workspaceId } })).statusCode, 401);
  assert.ok([401, 403].includes((await app.inject({
    method: "GET",
    url,
    headers: { ...memberHeaders, authorization: "Bearer invalid-token" }
  })).statusCode));
  assert.equal(findMembership.mock.callCount(), 0);
  assert.equal(getDocumentOriginal.mock.callCount(), 0);
});

test("originals require an explicit workspace UUID without a membership fallback", async (t) => {
  const { app, listMemberships, findMembership, getDocumentOriginal } = await fixture(t);
  const url = originalPath(documentId);
  assert.equal((await app.inject({ method: "GET", url, headers: { authorization } })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url, headers: { authorization, "x-workspace-id": "not-a-uuid" } })).statusCode, 400);
  assert.equal(listMemberships.mock.callCount(), 0);
  assert.equal(findMembership.mock.callCount(), 0);
  assert.equal(getDocumentOriginal.mock.callCount(), 0);
});

test("originals reject a workspace where the user has no membership", async (t) => {
  const { app, findMembership, getDocumentOriginal } = await fixture(t);
  const response = await app.inject({
    method: "GET",
    url: originalPath(documentId),
    headers: { ...memberHeaders, "x-workspace-id": otherWorkspaceId }
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(findMembership.mock.calls[0]?.arguments, [viewerId, otherWorkspaceId]);
  assert.equal(getDocumentOriginal.mock.callCount(), 0);
});

test("originals return 404 when the document has no original in the selected workspace", async (t) => {
  const { app, getDocumentOriginal, recordAuditEvent } = await fixture(t);
  const response = await app.inject({ method: "GET", url: originalPath(missingDocumentId), headers: memberHeaders });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(getDocumentOriginal.mock.calls[0]?.arguments, [{ tenantId: workspaceId, documentId: missingDocumentId }]);
  assert.equal(recordAuditEvent.mock.callCount(), 0);
});

test("a viewer can download a PDF as a private browser attachment", async (t) => {
  const { app, getDocumentOriginal, recordAuditEvent } = await fixture(t);
  const response = await app.inject({ method: "GET", url: originalPath(documentId), headers: memberHeaders });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(getDocumentOriginal.mock.calls[0]?.arguments, [{ tenantId: workspaceId, documentId }]);
  assert.equal(response.headers["content-type"], "application/pdf");
  assert.match(String(response.headers["content-disposition"]), /^attachment;.*source\.pdf/i);
  assert.match(String(response.headers["cache-control"]), /\bno-store\b/i);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["access-control-allow-origin"], webOrigin);
  assert.match(String(response.headers["access-control-expose-headers"]), /(?:^|,\s*)content-disposition(?:,|$)/i);
  assert.deepEqual(response.rawPayload, pdf.payload);
  assert.equal(recordAuditEvent.mock.callCount(), 1);
  assert.deepEqual(recordAuditEvent.mock.calls[0]?.arguments, [{
    tenantId: workspaceId,
    actorUserId: viewerId,
    action: "document.original_read",
    resourceType: "document",
    resourceId: documentId,
    requestId: response.headers["x-request-id"],
    metadata: {}
  }]);
});

test("hostile HTML is sent as a generic attachment with sniffing disabled", async (t) => {
  const html = {
    filename: "hostile.html",
    mimeType: "text/html",
    payload: Buffer.from("<script>alert(document.domain)</script>")
  };
  const { app } = await fixture(t, html);
  const response = await app.inject({ method: "GET", url: originalPath(documentId), headers: memberHeaders });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/octet-stream");
  assert.match(String(response.headers["content-disposition"]), /^attachment;/i);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.deepEqual(response.rawPayload, html.payload);
});

test("a PDF filename and MIME type cannot override the original's bytes", async (t) => {
  const spoofedPdf = { ...pdf, payload: Buffer.from("<html><script>alert(1)</script></html>") };
  const { app } = await fixture(t, spoofedPdf);
  const response = await app.inject({ method: "GET", url: originalPath(documentId), headers: memberHeaders });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/octet-stream");
  assert.deepEqual(response.rawPayload, spoofedPdf.payload);
});

test("direct text ingestion preserves metadata but cannot set the original's ingestion job", async (t) => {
  const previousConfig = { API_KEY: config.API_KEY, ADMIN_API_KEY: config.ADMIN_API_KEY, DEMO_MODE: config.DEMO_MODE };
  const adminKey = "fixture-direct-ingestion-key";
  Object.assign(config, { API_KEY: undefined, ADMIN_API_KEY: adminKey, DEMO_MODE: true });
  t.after(() => {
    Object.assign(config, previousConfig);
  });

  const ingest = t.mock.fn(async (_input: DocumentInput) => ({ id: documentId, chunkCount: 1, highRiskChunks: 0 }));
  const app = await buildApp({
    ingestDocument: { execute: ingest },
    consumeAdminUploadQuota: async () => ({ allowed: true, used: 0, limit: 1_000 }),
    recordAuditEvent: async () => {}
  } as unknown as Parameters<typeof buildApp>[0]);
  t.after(() => app.close());

  const input = { source: "fixture", title: "Direct text", text: "A sample document." };
  const metadata = { language: "en", tags: ["policy"] };
  const response = await app.inject({
    method: "POST",
    url: "/v1/documents",
    headers: { "x-admin-api-key": adminKey },
    payload: { ...input, metadata: { ...metadata, ingestionJobId: "5373e866-f92c-472a-8f0c-17a73f57eeef" } }
  });
  assert.equal(response.statusCode, 201);
  assert.equal(ingest.mock.callCount(), 1);
  assert.deepEqual(ingest.mock.calls[0]?.arguments, [{ ...input, metadata, tenantId: config.DEFAULT_TENANT_ID }]);
});
