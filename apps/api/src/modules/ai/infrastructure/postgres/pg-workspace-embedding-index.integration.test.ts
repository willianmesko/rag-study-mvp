import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { resolveWorkspaceEmbeddingIndex } from "../../application/ports/embedding-provider.js";
import { EmbeddingIndexChangedError, workspaceEmbeddingDimensions, type EmbeddingModelIdentity } from "../../application/ports/workspace-embedding-index.js";
import { IngestDocumentUseCase } from "../../../ingestion/application/use-cases/ingest-document.js";
import { rebuildWorkspaceEmbeddings } from "../../../knowledge/application/use-cases/rebuild-workspace-embeddings.js";
import { SearchDocumentsUseCase } from "../../../knowledge/application/use-cases/search-documents.js";
import { parseRuntimeConfiguration } from "../../../../app/configuration/environment.js";
import { createConfiguredProviderBindings } from "../../../../app/composition/provider-registry.js";
import { createWorkspaceEmbeddingAdapter, createWorkspaceEmbeddingProvider } from "../embedding/workspace-embedding-provider.js";
import { PassThroughReranker } from "../reranking/pass-through-reranker.js";
import { PgDocumentRepository } from "../../../knowledge/infrastructure/postgres/pg-document-repository.js";
import { PgSemanticAnswerCache } from "../../../chat/infrastructure/postgres/pg-semantic-answer-cache.js";
import { PgWorkspaceEmbeddingIndex } from "./pg-workspace-embedding-index.js";
import { toVectorLiteral } from "../../../../platform/database/pgvector.js";

const databaseUrl = process.env.TEST_EMBEDDING_DATABASE_URL;
const fixtureRequired = process.env.CI === "true" || process.env.REQUIRE_EMBEDDING_INDEX_TESTS === "true";
const dimensions = workspaceEmbeddingDimensions;
const oldModel: EmbeddingModelIdentity = { provider: "ollama", model: "fixture-old", dimensions };
const newModel: EmbeddingModelIdentity = { provider: "ollama", model: "fixture-new", dimensions };
const vector = (axis: number) => Array.from({ length: dimensions }, (_, index) => Number(index === axis));

test("a workspace embedding cutover is complete, scoped, cache-invalidating and reversible", { skip: !databaseUrl && !fixtureRequired }, async (t) => {
  assert.ok(databaseUrl, "TEST_EMBEDDING_DATABASE_URL is required in CI and when REQUIRE_EMBEDDING_INDEX_TESTS=true; cutover coverage must not be skipped.");
  const url = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && /^\/embedding_cutover_[a-zA-Z0-9_]+$/.test(url.pathname), "Use only a disposable local embedding_cutover_* fixture database.");
  const pool = new Pool({ connectionString: databaseUrl });
  const tenantId = randomUUID();
  const otherTenant = randomUUID();
  const configuration = parseRuntimeConfiguration({ EMBEDDING_PROVIDER: "ollama", OLLAMA_EMBEDDING_MODEL: oldModel.model });
  t.after(async () => {
    try {
      await pool.query("DELETE FROM documents WHERE tenant_id IN ($1, $2)", [tenantId, otherTenant]);
      await pool.query("DELETE FROM tenants WHERE id IN ($1, $2)", [tenantId, otherTenant]);
    } finally {
      await pool.end();
    }
  });

  const providerCalls: Array<{ model: string; input: string }> = [];
  let notifyInFlight!: () => void;
  let resumeInFlight!: () => void;
  const inFlightStarted = new Promise<void>((resolve) => { notifyInFlight = resolve; });
  const inFlightResume = new Promise<void>((resolve) => { resumeInFlight = resolve; });
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { model: string; input: string; dimensions: number };
    assert.equal(body.dimensions, dimensions);
    providerCalls.push(body);
    if (body.input.includes("in-flight test document")) {
      notifyInFlight();
      await inFlightResume;
    }
    return Response.json({ embeddings: [vector(body.model === newModel.model ? 1 : 0)] });
  });
  await pool.query("INSERT INTO tenants (id, slug, name) VALUES ($1::uuid, $1::uuid::text, 'Cutover fixture'), ($2::uuid, $2::uuid::text, 'Other workspace fixture')", [tenantId, otherTenant]);
  const index = new PgWorkspaceEmbeddingIndex(pool);
  const documents = new PgDocumentRepository(pool, dimensions);
  const cache = new PgSemanticAnswerCache(pool, dimensions);
  const bindings = createConfiguredProviderBindings(configuration);
  const adapter = (identity: EmbeddingModelIdentity) => createWorkspaceEmbeddingAdapter(identity, bindings.registry);
  const provider = createWorkspaceEmbeddingProvider(index, bindings.defaultEmbedding, adapter);
  const ingest = new IngestDocumentUseCase(provider, documents, { chunkSize: 1000, chunkOverlap: 100, embeddingConcurrency: 2 });
  const search = new SearchDocumentsUseCase(provider, documents, new PassThroughReranker(), {
    defaultTopK: 5, vectorCandidateMultiplier: 4, keywordCandidateMultiplier: 4, reciprocalRankConstant: 60,
    rerankerCandidateMultiplier: 4, defaultTenantId: tenantId
  });
  const sampleText = "A synthetic delivery note for example@example.test.";
  await ingest.execute({ tenantId, source: "lease-1", text: sampleText, sections: [{ text: sampleText }] });
  const isolatedDoc = await ingest.execute({ tenantId: otherTenant, source: "foreign-1", text: "A different workspace document." });
  const active = (await index.status(tenantId))[0]!;
  assert.equal(active.model, oldModel.model);

  const build = await index.startBuild(tenantId, newModel);
  assert.equal((await index.startBuild(tenantId, newModel)).id, build.id);
  const foreignChunk = (await documents.listChunks({ tenantId: otherTenant, documentId: isolatedDoc.id, limit: 1 }))[0]!;
  assert.equal(await index.stageVectors(tenantId, build.id, [{ id: foreignChunk.id, embedding: vector(1) }]), 0);
  await assert.rejects(index.stageVectors(tenantId, build.id, [{ id: foreignChunk.id, embedding: [1] }]), /1024 dimensions/);
  assert.equal((await rebuildWorkspaceEmbeddings(index, adapter(newModel), { tenantId, versionId: build.id, maxChunks: 1 })).stagedVectors, 1);

  // A new document is accepted by the old index while the backfill runs.
  await ingest.execute({ tenantId, source: "lease-2", text: "A later synthetic delivery note." });
  await assert.rejects(index.switchActive(tenantId, build.id, "activate"), /missing 1 current chunk/);
  assert.equal((await index.getOrPinActive(tenantId, newModel)).revision, active.revision);
  await rebuildWorkspaceEmbeddings(index, adapter(newModel), { tenantId, versionId: build.id, maxChunks: 10 });

  const literal = toVectorLiteral(vector(0), dimensions);
  await pool.query(
    `INSERT INTO semantic_answer_cache (tenant_id, question_hash, embedding, answer, expires_at)
     SELECT id, repeat('a',64), $3::vector, 'fixture', NOW() + interval '1 hour' FROM tenants WHERE id IN ($1, $2)`,
    [tenantId, otherTenant, literal]
  );
  await pool.query(
    `INSERT INTO semantic_model_answer_cache (tenant_id, model_key, question_hash, embedding, answer, expires_at)
     SELECT id, 'fixture', repeat('a',64), $3::vector, 'fixture', NOW() + interval '1 hour' FROM tenants WHERE id IN ($1, $2)`,
    [tenantId, otherTenant, literal]
  );

  const staleWrite = assert.rejects(ingest.execute({ tenantId, source: "stale", text: "An in-flight test document uses its old model." }), EmbeddingIndexChangedError);
  await inFlightStarted;
  const oldCacheInput = { tenantId, modelKey: "fixture", embedding: vector(0), minimumSimilarity: 0.99, embeddingIndexVersion: active.revision };
  assert.equal((await cache.findSimilar(oldCacheInput))?.answer, "fixture");
  const switched = await index.switchActive(tenantId, build.id, "activate").finally(resumeInFlight);
  await staleWrite;
  assert.equal(switched.model, newModel.model);
  assert.notEqual(switched.revision, build.revision);
  assert.equal((await resolveWorkspaceEmbeddingIndex(provider, tenantId)).version, switched.revision);
  assert.equal((await resolveWorkspaceEmbeddingIndex(provider, otherTenant)).identity?.model, oldModel.model);
  await assert.rejects(search.execute({ tenantId, query: "delivery", queryEmbedding: vector(0), embeddingIndexVersion: active.revision }), EmbeddingIndexChangedError);
  await assert.rejects(documents.replace({ tenantId, source: "stale", metadata: {}, embeddingIndexVersion: active.revision }, []), EmbeddingIndexChangedError);
  await assert.rejects(cache.findSimilar(oldCacheInput), EmbeddingIndexChangedError);
  await cache.put({ ...oldCacheInput, questionHash: "b".repeat(64), answer: "stale", sources: [], expiresAt: new Date(Date.now() + 60_000) });
  const newSearch = await search.execute({ tenantId, query: "delivery" });
  assert.equal(newSearch.length, 2);
  assert.ok(newSearch.every((chunk) => chunk.score > 0.99));
  for (const table of ["semantic_answer_cache", "semantic_model_answer_cache"]) {
    const cached = await pool.query(`SELECT tenant_id FROM ${table} WHERE tenant_id IN ($1, $2)`, [tenantId, otherTenant]);
    assert.deepEqual(cached.rows, [{ tenant_id: otherTenant }]);
  }

  const rolledBack = await index.switchActive(tenantId, active.id, "rollback");
  assert.equal(rolledBack.model, oldModel.model);
  assert.notEqual(rolledBack.revision, active.revision);
  const rolledBackSearch = await search.execute({ tenantId, query: "delivery" });
  assert.equal(rolledBackSearch.length, 2);
  assert.ok(rolledBackSearch.every((chunk) => chunk.score > 0.99));
  assert.ok(providerCalls.some(({ model, input }) => model === newModel.model && input.includes("[REDACTED_EMAIL]")));
  assert.ok(providerCalls.every(({ input }) => !input.includes("example@example.test")));

  await ingest.execute({ tenantId, source: "lease-3", text: "A newly indexed synthetic delivery note." });
  await assert.rejects(index.switchActive(tenantId, build.id, "rollback"), /missing 1 current chunk/);
  assert.equal((await index.getOrPinActive(tenantId, newModel)).revision, rolledBack.revision);
});
