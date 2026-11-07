import {UploadAdmissionError} from '../../modules/ingestion/application/ports/ingestion-job-repository.js';
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { AuditEventRepository } from "../../modules/usage/application/ports/audit-event-repository.js";
import { PublicHtmlFetchError } from "../../modules/ingestion/application/ports/public-html-fetcher.js";
import type { QueueDocumentUploadUseCase } from "../../modules/ingestion/application/use-cases/queue-document-upload.js";
import { config } from "../../config.js";
import { buildApp } from "../http-server.js";

const endpoint = "/v1/admin/uploads/url";
const authUrl = "https://auth.example.test";
const tenantId = "3f59c6e7-f83c-4d23-bc27-3bd20ba91848";
const userId = "130e58cf-aee0-4bd3-971e-4bb210211a5a";
const headers = { authorization: "Bearer url-import-fixture", "x-workspace-id": tenantId };
const url = "https://example.com/guide";
const page = { url: "https://example.com/guides/rag", filename: "example.com.html", payload: Buffer.from("<h1>RAG guide</h1>") };

async function fixture(t: TestContext, options: { role?: "viewer"; allowed?: boolean; error?: PublicHtmlFetchError } = {}) {
  const savedConfig = { SUPABASE_URL: config.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: config.SUPABASE_PUBLISHABLE_KEY, API_KEY: config.API_KEY };
  Object.assign(config, { SUPABASE_URL: authUrl, SUPABASE_PUBLISHABLE_KEY: "fixture-publishable-key", API_KEY: undefined });
  t.after(() => { Object.assign(config, savedConfig); });
  t.mock.method(globalThis, "fetch", async (address: string) => {
    assert.equal(String(address), `${authUrl}/auth/v1/user`);
    return Response.json({ id: userId, aud: "authenticated", role: "authenticated" });
  });
  const download = t.mock.fn(async (_url: string) => {
    if (options.error) throw options.error;
    return page;
  });
  const consumeAdminUploadQuota = t.mock.fn(async (_tenantId: string, _userId: string, _bytes: number) => ({ allowed: options.allowed ?? true, used: null, limit: 1_000 }));
  const queue = t.mock.fn(async (input: Parameters<QueueDocumentUploadUseCase["execute"]>[0]) => {
    if(options.allowed===false)throw new UploadAdmissionError('upload_quota_exceeded');
    const now = new Date();
    return {
      ...input, title: input.title ?? null, id: "fixture-job", documentId: null, storagePath: null,
      status: "queued" as const, progress: 0, error: null, chunkCount: null, highRiskChunks: null, createdAt: now, updatedAt: now
    };
  });
  const audit = t.mock.fn(async (_input: Parameters<AuditEventRepository["record"]>[0]) => {});
  const app = await buildApp({
    findMembership: async (actor: string, requested: string) => actor === userId && requested === tenantId
      ? { tenantId, tenantName: "Legal", tenantSlug: "legal", role: options.role ?? "editor" } : null,
    publicHtmlFetcher: { fetch: download },
    queueDocumentUpload: { execute: queue },
    consumeAdminUploadQuota,
    recordAuditEvent: audit
  } as unknown as Parameters<typeof buildApp>[0]);
  t.after(() => app.close());
  return { app, download, consumeAdminUploadQuota, queue, audit };
}

test("URL import checks membership, workspace and role before starting a download", async (t) => {
  const { app, download } = await fixture(t, { role: "viewer" });
  const request = { method: "POST" as const, url: endpoint, payload: { url } };
  assert.equal((await app.inject(request)).statusCode, 401);
  assert.equal((await app.inject({ ...request, headers: { authorization: headers.authorization } })).statusCode, 400);
  assert.equal((await app.inject({ ...request, headers: { ...headers, "x-workspace-id": userId } })).statusCode, 403);
  assert.equal((await app.inject({ ...request, headers })).statusCode, 403);
  assert.equal(download.mock.callCount(), 0);
});

test("URL import charges the workspace quota and queues the original HTML under the resolved URL", async (t) => {
  const { app, download, consumeAdminUploadQuota, queue, audit } = await fixture(t);
  const response = await app.inject({ method: "POST", url: endpoint, headers, payload: { url, title: " RAG " } });
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().job.source, page.url);
  assert.deepEqual(download.mock.calls[0]?.arguments, [url]);
  assert.equal(consumeAdminUploadQuota.mock.callCount(),0); // Admission and quota commit together in the queue repository.
  assert.deepEqual(queue.mock.calls[0]?.arguments, [{ tenantId, actorId:userId, source: page.url, filename: page.filename, mimeType: "text/html", payload: page.payload, title: "RAG" }]);
  assert.deepEqual(audit.mock.calls[0]?.arguments[0]?.metadata, { bytes: page.payload.length, mimeType: "text/html", sourceType: "url" });
});

test("URL import never queues an upload if the byte quota is exhausted", async (t) => {
  const { app, queue, audit } = await fixture(t, { allowed: false });
  const response = await app.inject({ method: "POST", url: endpoint, headers, payload: { url } });
  assert.equal(response.statusCode, 429);
  assert.equal(queue.mock.callCount(), 1);
  assert.equal(audit.mock.callCount(), 0);
});

test("URL import returns the safe blocked-destination error without enqueuing anything", async (t) => {
  const { app, queue, consumeAdminUploadQuota } = await fixture(t, { error: new PublicHtmlFetchError("unsafe_destination") });
  const response = await app.inject({ method: "POST", url: endpoint, headers, payload: { url } });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "unsafe_destination");
  assert.equal(queue.mock.callCount(), 0);
  assert.equal(consumeAdminUploadQuota.mock.callCount(), 0);
});
