import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { PgEvaluationRepository } from "../../modules/evaluations/infrastructure/postgres/pg-evaluation-repository.js";
import { PgSemanticAnswerCache } from "../../modules/chat/infrastructure/postgres/pg-semantic-answer-cache.js";
import { StoredRecordError } from "./stored-record.js";

const tenant = "11111111-1111-4111-a111-111111111111", id = "22222222-2222-4222-a222-222222222222";
const row = () => ({
  id, tenant_id: tenant, dataset_name: "fixture", dataset_version: "1", commit_sha: null,
  embedding_provider: "fixture", embedding_model: "fixed-index", chat_provider: "fixture", chat_model: "fixture-chat",
  total_cases: 4, hit_rate: "0.750000", mean_reciprocal_rank: "0.625000", faithfulness: null,
  context_precision: "1.000000", injection_pass_rate: "1.000000", passed: true, duration_ms: 123,
  failure_details: { caseIds: ["fixture-1"] }, created_at: new Date("2026-11-07T12:00:00Z"),
});
const fakePool = (rows: unknown[]) => ({ query: async () => ({ rows }) }) as unknown as Pool;
function sanitized(error: unknown) {
  assert.ok(error instanceof StoredRecordError);
  assert.equal(error.code, "invalid_stored_record");
  assert.equal(error.message, "Stored data failed validation.");
  assert.ok(!JSON.stringify(error).includes("PRIVATE_SENTINEL"));
  assert.equal(error.cause, undefined);
  return true;
}

test("evaluation rows decode PostgreSQL decimal ratios while preserving unknown metrics as null", async () => {
  const repo = new PgEvaluationRepository(fakePool([row()]));
  const [result] = await repo.list(tenant, 10);
  assert.ok(result); assert.equal(result.hitRate, 0.75); assert.equal(result.meanReciprocalRank, 0.625);
  assert.equal(result.contextPrecision, 1); assert.equal(result.faithfulness, null);
  assert.equal(result.createdAt.toISOString(), "2026-11-07T12:00:00.000Z");
  assert.deepEqual(result.failureDetails, { caseIds: ["fixture-1"] });
  assert.deepEqual(await new PgEvaluationRepository(fakePool([])).list(tenant, 10), []);
});

test("missing insert rows and malformed evaluation measurements fail without coercion or stored details", async () => {
  const input = { tenantId: tenant, datasetName: "fixture", datasetVersion: "1", commitSha: null,
    embeddingProvider: "fixture", embeddingModel: "fixed-index", chatProvider: "fixture", chatModel: "fixture-chat",
    totalCases: 4, hitRate: 0.75, meanReciprocalRank: 0.625, faithfulness: null, contextPrecision: 1,
    injectionPassRate: 1, passed: true, durationMs: 123, failureDetails: {} };
  await assert.rejects(new PgEvaluationRepository(fakePool([])).create(input), sanitized);
  for (const patch of [
    { hit_rate: null }, { hit_rate: "" }, { hit_rate: "NaN" }, { hit_rate: "Infinity" }, { hit_rate: "PRIVATE_SENTINEL" },
    { hit_rate: "1.000001" }, { hit_rate: -0.1 }, { total_cases: 1.5 }, { passed: "true" },
    { created_at: new Date("invalid") }, { failure_details: null }, { failure_details: ["PRIVATE_SENTINEL"] },
  ]) await assert.rejects(new PgEvaluationRepository(fakePool([{ ...row(), ...patch }])).list(tenant, 10), sanitized);
});

function cache(rows: unknown[]) {
  const statements: Array<{ sql: string; params: unknown[] }> = [], releases: boolean[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      return { rows: sql.includes("FROM semantic_model_answer_cache") ? rows : [], rowCount: sql.includes("pg_catalog.pg_settings") ? 3 : 0 };
    },
    on() {}, removeListener() {}, release(destroy?: boolean) { releases.push(Boolean(destroy)); },
  };
  const pool = { connect: async () => client } as unknown as Pool;
  return { repo: new PgSemanticAnswerCache(pool, 2), statements, releases };
}
const lookup = { tenantId: tenant, modelKey: "fixture-model-prompt-index", embedding: [1, 0], minimumSimilarity: 0.96 };
const citation = { chunkId: id, documentId: tenant, source: "fixture/source", title: null, ordinal: 0, score: 0.82, content: "Synthetic passage." };

test("semantic-cache JSON decodes bounded passages and retains workspace/model SQL scope", async () => {
  const fixture = cache([{ answer: "Synthetic answer.", sources: [{ ...citation, extra: "discarded" }], similarity: 0.99 }]);
  assert.deepEqual(await fixture.repo.findSimilar(lookup), { answer: "Synthetic answer.", sources: [citation], similarity: 0.99 });
  const query = fixture.statements.find(({ sql }) => sql.includes("FROM semantic_model_answer_cache"));
  assert.ok(query); assert.match(query.sql, /tenant_id = \$1 AND model_key = \$3/);
  assert.deepEqual(query.params, [tenant, "[1,0]", lookup.modelKey]); assert.deepEqual(fixture.releases, [false]);
  assert.equal(await cache([]).repo.findSimilar(lookup), null);
  assert.equal(await cache([{ answer: "Low match.", sources: [], similarity: 0.8 }]).repo.findSimilar(lookup), null);
});

test("malformed cached passages and non-finite similarity fail closed after releasing the connection", async () => {
  for (const row of [
    { answer: "PRIVATE_SENTINEL", sources: null, similarity: 0.99 },
    { answer: "PRIVATE_SENTINEL", sources: [{ ...citation, chunkId: "not-a-uuid" }], similarity: 0.99 },
    { answer: "PRIVATE_SENTINEL", sources: [{ ...citation, ordinal: -1 }], similarity: 0.99 },
    { answer: "PRIVATE_SENTINEL", sources: [{ ...citation, content: 12 }], similarity: 0.99 },
    { answer: "PRIVATE_SENTINEL", sources: Array(21).fill(citation), similarity: 0.99 },
    { answer: "PRIVATE_SENTINEL", sources: [], similarity: Number.NaN },
    { answer: "PRIVATE_SENTINEL", sources: [], similarity: Number.POSITIVE_INFINITY },
    { answer: "PRIVATE_SENTINEL", sources: [], similarity: "0.99" },
  ]) {
    const fixture = cache([row]); await assert.rejects(fixture.repo.findSimilar(lookup), sanitized);
    assert.deepEqual(fixture.releases, [false]);
  }
});
