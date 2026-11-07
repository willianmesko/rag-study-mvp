import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PgEvaluationRepository } from "../../modules/evaluations/infrastructure/postgres/pg-evaluation-repository.js";
import { PgSemanticAnswerCache } from "../../modules/chat/infrastructure/postgres/pg-semantic-answer-cache.js";
import { StoredRecordError } from "./stored-record.js";

const databaseUrl = process.env.MCP_TEST_DATABASE_URL;
const options = { skip: !databaseUrl, timeout: 30_000 };

async function fixture(t: import("node:test").TestContext) {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl!).hostname), "Use a disposable local database.");
  const pool = new Pool({ connectionString: databaseUrl, max: 2 }), tenant = randomUUID();
  t.after(async () => { try { await pool.query("DELETE FROM tenants WHERE id = $1", [tenant]); } finally { await pool.end(); } });
  await pool.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,$3)", [tenant, `stored-row-${tenant}`, "Synthetic stored-record fixture"]);
  return { pool, tenant };
}

test("PostgreSQL evaluation records preserve decimal/null metrics, tenant scope and sanitized corruption failures", options, async (t) => {
  const { pool, tenant } = await fixture(t), repo = new PgEvaluationRepository(pool);
  const created = await repo.create({ tenantId: tenant, datasetName: "synthetic", datasetVersion: "1", commitSha: null,
    embeddingProvider: "fixture", embeddingModel: "fixed", chatProvider: "fixture", chatModel: "fixed",
    totalCases: 4, hitRate: 0.75, meanReciprocalRank: 0.625, faithfulness: null, contextPrecision: 1,
    injectionPassRate: 1, passed: true, durationMs: 12, failureDetails: {} });
  assert.equal(created.hitRate, 0.75); assert.equal(created.faithfulness, null); assert.equal(created.meanReciprocalRank, 0.625);
  assert.ok(created.createdAt instanceof Date);
  const raw = await pool.query<{ hit_rate: string; faithfulness: null }>("SELECT hit_rate,faithfulness FROM evaluation_runs WHERE id=$1", [created.id]);
  assert.equal(typeof raw.rows[0]?.hit_rate, "string"); assert.equal(raw.rows[0]?.faithfulness, null);
  assert.deepEqual(await repo.list(randomUUID(), 10), []);
  assert.equal((await repo.list(tenant, 10))[0]?.id, created.id);
  await pool.query("UPDATE evaluation_runs SET failure_details=$2::jsonb WHERE id=$1", [created.id, '["PRIVATE_SENTINEL"]']);
  await assert.rejects(repo.list(tenant, 10), (error: unknown) => {
    assert.ok(error instanceof StoredRecordError); assert.equal(error.message, "Stored data failed validation.");
    assert.ok(!JSON.stringify(error).includes("PRIVATE_SENTINEL")); return true;
  });
});

test("PostgreSQL semantic-cache records decode JSON passages without losing model/workspace isolation", options, async (t) => {
  const { pool, tenant } = await fixture(t), repo = new PgSemanticAnswerCache(pool, 1024);
  const embedding = Array<number>(1024).fill(0); embedding[0] = 1;
  const source = { chunkId: randomUUID(), documentId: randomUUID(), source: "synthetic/handbook", title: null, ordinal: 0, score: 0.9, content: "Synthetic passage." };
  const input = { tenantId: tenant, modelKey: "synthetic-prompt-index", embedding, minimumSimilarity: 0.96 };
  await repo.put({ ...input, questionHash: "a".repeat(64), answer: "Synthetic answer.", sources: [source], expiresAt: new Date(Date.now() + 60_000) });
  assert.deepEqual((await repo.findSimilar(input))?.sources, [source]);
  assert.equal(await repo.findSimilar({ ...input, tenantId: randomUUID() }), null);
  assert.equal(await repo.findSimilar({ ...input, modelKey: "another-model" }), null);
  await pool.query("UPDATE semantic_model_answer_cache SET sources=$2::jsonb WHERE tenant_id=$1", [tenant, JSON.stringify([{ ...source, content: 123 }])]);
  await assert.rejects(repo.findSimilar(input), StoredRecordError);
  assert.equal((await pool.query("SELECT 1 AS ok")).rows[0]?.ok, 1);
});
