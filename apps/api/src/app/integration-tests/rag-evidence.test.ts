import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { AuditEventRepository } from "../../modules/usage/application/ports/audit-event-repository.js";
import type { AnswerQuestionResult } from "../../modules/chat/application/ports/question-answering-workflow.js";
import { config } from "../../config.js";
import type { RetrievedChunk } from "../../modules/knowledge/domain/document.js";
import { buildApp } from "../http-server.js";

const authUrl = "https://auth.example.test";
const userId = "9705f665-7eba-440a-822b-8349f4bc43d4";
const tenantId = "64836a45-f42f-46c8-9f62-29b12ad209c4";
const jobId = "e2366084-be43-4c01-a71f-d46dbfc7168f";
const headers = { authorization: "Bearer evidence-fixture", "x-workspace-id": tenantId };
const previewUrl = `/v1/admin/uploads/${jobId}/preview`;
const crossingEmail = `${"a".repeat(591)} private@example.com and additional text.`;
const safeMatch: RetrievedChunk = {
  chunkId: "context-1", documentId: "document-1", ordinal: 0, content: crossingEmail,
  source: "guide", title: "RAG guide", score: -0.15, security: { promptInjectionRisk: "low", signals: [] }
};
const blockedMatch: RetrievedChunk = {
  ...safeMatch, chunkId: "context-2", ordinal: 1, content: "High-risk instructions must never appear in the preview.",
  security: { promptInjectionRisk: "high", signals: ["instruction-override"] }
};

async function fixture(t: TestContext, role: "editor" | "viewer" = "editor") {
  const configOverrides = { SUPABASE_URL: authUrl, SUPABASE_PUBLISHABLE_KEY: "fixture-publishable-key", API_KEY: undefined };
  const previousConfig = { SUPABASE_URL: config.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: config.SUPABASE_PUBLISHABLE_KEY, API_KEY: config.API_KEY };
  Object.assign(config, configOverrides);
  t.after(() => { Object.assign(config, previousConfig); });
  t.mock.method(globalThis, "fetch", async (address: string) => {
    assert.equal(String(address), `${authUrl}/auth/v1/user`);
    return Response.json({ id: userId, aud: "authenticated", role: "authenticated" });
  });

  const audit = t.mock.fn(async (_event: Parameters<AuditEventRepository["record"]>[0]) => {});
  const preview = t.mock.fn(async (input: { jobId: string; tenantId: string }) =>
    input.tenantId === tenantId && input.jobId === jobId ? { totalChunks: 12, passages: [safeMatch, blockedMatch] } : null
  );
  const answer: AnswerQuestionResult = {
    answer: "RAG uses retrieval and generation.", structuredOutput: true,
    sources: [safeMatch], citedChunkIds: [safeMatch.chunkId],
    contextSources: [safeMatch, { ...safeMatch, ordinal: 2, chunkId: "context-3", content: "Additional context." }]
  };
  const app = await buildApp({
    findMembership: async (actor: string, requested: string) => actor === userId && requested === tenantId
      ? { tenantId, tenantName: "Legal", tenantSlug: "legal", role } : null,
    consumeQuestionQuota: async () => ({ allowed: true, used: 1, limit: 30 }),
    searchDocuments: { execute: async () => [safeMatch, blockedMatch] },
    answerQuestion: { execute: async () => answer },
    previewIngestionPassages: preview,
    recordAuditEvent: audit
  } as unknown as Parameters<typeof buildApp>[0]);
  t.after(() => app.close());
  return { app, preview, audit };
}

test("processing previews require an explicit workspace and editor permission", async (t) => {
  const { app, preview } = await fixture(t, "viewer");
  assert.equal((await app.inject({ url: previewUrl })).statusCode, 401);
  assert.equal((await app.inject({ url: previewUrl, headers: { authorization: headers.authorization } })).statusCode, 400);
  assert.equal((await app.inject({ url: previewUrl, headers })).statusCode, 403);
  assert.equal(preview.mock.callCount(), 0);
});

test("processing previews audit scoped reads and redact before clipping, with high-risk text hidden", async (t) => {
  const { app, preview, audit } = await fixture(t);
  const response = await app.inject({ url: previewUrl, headers });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(preview.mock.calls[0]?.arguments, [{ jobId, tenantId }]);
  const body = response.json();
  assert.equal(body.totalChunks, 12);
  assert.equal(body.passages[0].excerpt.length, 600);
  assert.equal(body.passages[0].excerptTruncated, true);
  assert.doesNotMatch(body.passages[0].excerpt, /private@/);
  assert.equal(body.passages[1].previewBlocked, true);
  assert.equal(body.passages[1].excerpt, "");
  assert.equal(audit.mock.calls[0]?.arguments[0]?.action, "ingestion.preview_read");
  assert.deepEqual(audit.mock.calls[0]?.arguments[0]?.metadata, {});
});

test("search preserves cosine scores and serves only restricted previews", async (t) => {
  const { app } = await fixture(t);
  const response = await app.inject({ url: "/v1/search?q=rag", headers });
  assert.equal(response.statusCode, 200);
  const [safe, blocked] = response.json().results;
  assert.equal(safe.score, -0.15);
  assert.equal(safe.previewBlocked, false);
  assert.equal(safe.previewTruncated, true);
  assert.equal(safe.content.length, 600);
  assert.doesNotMatch(safe.content, /private@/);
  assert.equal(blocked.previewBlocked, true);
  assert.equal(blocked.content, "");
});

test("Q&A returns citations separately from the passages sent to the model", async (t) => {
  const { app } = await fixture(t);
  const response = await app.inject({ method: "POST", url: "/v1/qa", headers, payload: { question: "What is RAG?" } });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(body.citedChunkIds, ["context-1"]);
  assert.deepEqual(body.sources.map(({ chunkId }: { chunkId: string }) => chunkId), ["context-1"]);
  assert.deepEqual(body.contextSources.map(({ chunkId }: { chunkId: string }) => chunkId), ["context-1", "context-3"]);
  assert.equal(body.sources[0].excerptTruncated, true);
  assert.doesNotMatch(body.sources[0].excerpt, /private@/);
  assert.equal(body.cacheHit, false);
});
