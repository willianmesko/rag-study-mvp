import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PgEvaluationRepository } from "../../modules/evaluations/infrastructure/postgres/pg-evaluation-repository.js";
import { PgSemanticAnswerCache } from "../../modules/chat/infrastructure/postgres/pg-semantic-answer-cache.js";
import { StoredRecordError } from "./stored-record.js";
import { PgWorkspaceModelPolicyRepository } from "../../modules/chat/infrastructure/postgres/pg-workspace-model-policy-repository.js";
import { PgWorkspaceOnboardingRepository } from "../../modules/workspaces/infrastructure/postgres/pg-workspace-onboarding-repository.js";
import { PgConversationRepository } from "../../modules/chat/infrastructure/postgres/pg-conversation-repository.js";

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

test("PostgreSQL workspace routing rejects invalid stored JSON with a safe server error and remains usable", options, async (t) => {
  const { pool, tenant } = await fixture(t), repo = new PgWorkspaceModelPolicyRepository(pool);
  const policy = { allowedModelIds: ["default", "alternate"], defaultModelId: "default", auto: {
    simpleModelId: "default", complexModelId: "alternate", fallbackModelIds: ["default"]
  } };
  assert.equal(await repo.get(tenant), null);
  assert.deepEqual(await repo.save(tenant, policy), policy);
  assert.deepEqual(await repo.get(tenant), policy);
  assert.equal(await repo.get(randomUUID()), null);
  // This object satisfies the database's object/size constraint, but not the routing contract.
  await pool.query("UPDATE workspace_chat_model_policies SET policy=$2::jsonb WHERE tenant_id=$1", [tenant, JSON.stringify({ ...policy, defaultModelId: "PRIVATE_SENTINEL" })]);
  await assert.rejects(repo.get(tenant), (error: unknown) => {
    assert.ok(error instanceof StoredRecordError); assert.equal(error.code, "invalid_stored_record");
    assert.ok(!JSON.stringify(error).includes("PRIVATE_SENTINEL")); assert.equal(error.cause, undefined); return true;
  });
  assert.deepEqual(await repo.save(tenant, policy), policy);
});

test("PostgreSQL onboarding preserves monotonic progress and independent user/workspace records", options, async (t) => {
  const { pool, tenant } = await fixture(t), repo = new PgWorkspaceOnboardingRepository(pool);
  const userId = randomUUID(), peerId = randomUUID(), scope = { tenantId: tenant, userId };
  await pool.query("INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'viewer')", [tenant, userId, peerId]);
  assert.equal(await repo.get(scope), null);
  assert.deepEqual(await repo.save(scope, { goal: null, step: "purpose", completed: false }), { goal: null, step: "purpose", completed: false });
  const complete = { goal: "support" as const, step: "answer" as const, completed: true };
  assert.deepEqual(await repo.save(scope, complete), complete);
  assert.deepEqual(await repo.save(scope, { goal: "learning", step: "knowledge", completed: false }), complete);
  const peer = { tenantId: tenant, userId: peerId }, peerProgress = { goal: "learning" as const, step: "knowledge" as const, completed: false };
  assert.equal(await repo.get(peer), null);
  assert.deepEqual(await repo.save(peer, peerProgress), peerProgress);
  assert.deepEqual(await repo.get(scope), complete);
  assert.deepEqual(await repo.get(peer), peerProgress);
  assert.equal(await repo.get({ ...scope, tenantId: randomUUID() }), null);
  const raw = await pool.query("SELECT furthest_step FROM workspace_onboarding WHERE tenant_id=$1 AND user_id=$2", [tenant, userId]);
  assert.equal(typeof raw.rows[0]?.furthest_step, "number");
});

test("PostgreSQL conversation corruption fails safely and its scoped terminal transition preserves other pending work", options, async (t) => {
  const { pool, tenant } = await fixture(t), repo = new PgConversationRepository(pool), userId = randomUUID();
  await pool.query("INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [tenant, userId]);
  const owner = { tenantId: tenant, userId }, badId = randomUUID(), goodId = randomUUID(), badRun = randomUUID(), goodRun = randomUUID();
  await repo.create(owner, badId, "Synthetic corrupt fixture");
  await repo.create(owner, goodId, "Synthetic valid fixture");
  const bad = { ...owner, conversationId: badId }, good = { ...owner, conversationId: goodId };
  await repo.admit({ ...bad, runId: badRun, mode: "answer", input: { question: "Synthetic first question?" } });
  await repo.admit({ ...good, runId: goodRun, mode: "answer", input: { question: "Synthetic second question?" } });
  const corrupt = { question: 17, detail: "PRIVATE_SENTINEL" };
  await pool.query("UPDATE conversation_turns SET input=$4::jsonb WHERE tenant_id=$1 AND owner_id=$2 AND run_id=$3", [tenant, userId, badRun, JSON.stringify(corrupt)]);
  await assert.rejects(repo.turn(bad, badRun), StoredRecordError);
  await assert.rejects(repo.messages(bad, 10), StoredRecordError);
  assert.equal((await repo.messages(good, 10)).turns[0]?.question, "Synthetic second question?");
  // Dispatch, shutdown and per-item recovery isolation are exercised through
  // the application ports; this SQL case stays scoped to its own records.
  await repo.fail(bad, badRun);
  const status = await pool.query("SELECT status,failure_code FROM conversation_turns WHERE tenant_id=$1 AND run_id=$2", [tenant, badRun]);
  assert.deepEqual(status.rows[0], { status: "failed", failure_code: "execution_failed" });
  assert.equal((await repo.turn(good, goodRun))?.status, "queued");
  // Repair is explicit; the application never replaces a corrupt question.
  await pool.query("UPDATE conversation_turns SET input=$3::jsonb WHERE tenant_id=$1 AND run_id=$2", [tenant, badRun, JSON.stringify({ question: "Synthetic first question?" })]);
  assert.equal((await repo.turn(bad, badRun))?.status, "failed");
});
