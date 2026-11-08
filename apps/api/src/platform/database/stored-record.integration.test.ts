import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PgEvaluationRepository } from "../../modules/evaluations/infrastructure/postgres/pg-evaluation-repository.js";
import { PgMcpReadRepository } from "../../modules/mcp/infrastructure/postgres/pg-mcp-read-repository.js";
import { PgIngestionJobRepository } from "../../modules/ingestion/infrastructure/postgres/pg-ingestion-job-repository.js";
import { PgSemanticAnswerCache } from "../../modules/chat/infrastructure/postgres/pg-semantic-answer-cache.js";
import { StoredRecordError } from "./stored-record.js";
import { PgWorkspaceModelPolicyRepository } from "../../modules/chat/infrastructure/postgres/pg-workspace-model-policy-repository.js";
import { PgWorkspaceOnboardingRepository } from "../../modules/workspaces/infrastructure/postgres/pg-workspace-onboarding-repository.js";
import { PgConversationRepository } from "../../modules/chat/infrastructure/postgres/pg-conversation-repository.js";
import { PgMcpOAuthRepository } from "../../modules/mcp/infrastructure/postgres/pg-mcp-oauth-repository.js";

const databaseUrl = process.env.MCP_TEST_DATABASE_URL;
const options = { skip: !databaseUrl, timeout: 30_000 };

test("PostgreSQL OAuth clients reject constraint-valid malformed callback arrays and recover after repair", options, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl!).hostname), "Use a disposable local database.");
  const pool = new Pool({ connectionString: databaseUrl, max: 2 }), repository = new PgMcpOAuthRepository(pool);
  const id = "lumora_client_" + randomBytes(32).toString("base64url"), redirectUris = ["https://example.com/callback", "http://localhost:12345/callback"];
  t.after(async () => { try { await pool.query("DELETE FROM mcp_oauth_clients WHERE id=$1", [id]); } finally { await pool.end(); } });
  const client = await repository.register({ id, name: "Synthetic callback fixture", redirectUris });
  assert.equal(client.id, id); assert.deepEqual(client.redirectUris, redirectUris); assert.ok(client.expiresAt instanceof Date);
  assert.deepEqual(await repository.client(id), client);
  assert.equal(await repository.client("lumora_client_" + "x".repeat(43)), null);
  for (const value of [[42], [{ value: "PRIVATE_CALLBACK" }], ["javascript:alert(1)"]]) {
    try {
      await pool.query("UPDATE mcp_oauth_clients SET redirect_uris=$2::jsonb WHERE id=$1", [id, JSON.stringify(value)]);
      await assert.rejects(repository.client(id), (error: unknown) => error instanceof StoredRecordError &&
        !String(error).includes("PRIVATE_") && !JSON.stringify(error).includes("PRIVATE_") && !("cause" in error));
    } finally { await pool.query("UPDATE mcp_oauth_clients SET redirect_uris=$2::jsonb WHERE id=$1", [id, JSON.stringify(redirectUris)]); }
  }
  assert.deepEqual(await repository.client(id), client);
  await pool.query("UPDATE mcp_oauth_clients SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [id]);
  assert.equal(await repository.client(id), null);
});

async function fixture(t: import("node:test").TestContext) {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl!).hostname), "Use a disposable local database.");
  const pool = new Pool({ connectionString: databaseUrl, max: 2 }), tenant = randomUUID();
  t.after(async () => {
    try {
      await pool.query("DELETE FROM ingestion_jobs WHERE tenant_id = $1", [tenant]);
      await pool.query("DELETE FROM documents WHERE tenant_id = $1", [tenant]);
      await pool.query("DELETE FROM tenants WHERE id = $1", [tenant]);
    } finally { await pool.end(); }
  });
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

test("PostgreSQL MCP quality records preserve driver decimal/null/Date values and workspace isolation", options, async (t) => {
  const { pool, tenant } = await fixture(t), repository = new PgEvaluationRepository(pool);
  const created = await repository.create({ tenantId: tenant, datasetName: "synthetic MCP", datasetVersion: "1", commitSha: null,
    embeddingProvider: "fixture", embeddingModel: "fixed", chatProvider: "fixture", chatModel: "fixed",
    totalCases: 4, hitRate: 0.75, meanReciprocalRank: 0.625, faithfulness: null, contextPrecision: 0,
    injectionPassRate: 1, passed: false, durationMs: 12, failureDetails: {} });
  const reads = new PgMcpReadRepository(pool);
  const [report] = await reads.getQualityReport(tenant, 10, new AbortController().signal);
  assert.ok(report); assert.equal(report.id, created.id);
  assert.equal(report.hitRate, 0.75); assert.equal(report.meanReciprocalRank, 0.625);
  assert.equal(report.faithfulness, null); assert.equal(report.contextPrecision, 0); assert.equal(report.passed, false);
  assert.ok(report.createdAt instanceof Date);
  assert.deepEqual(await reads.getQualityReport(randomUUID(), 10, new AbortController().signal), []);
  assert.equal((await reads.getQualityReport(tenant, 1, new AbortController().signal)).length, 1);
});

test("PostgreSQL timeline details reject non-object JSON, preserve scope and recover after repair", options, async (t) => {
  const { pool, tenant } = await fixture(t), repository = new PgIngestionJobRepository(pool), jobId = randomUUID();
  await pool.query(`INSERT INTO ingestion_jobs(id,tenant_id,source,filename,mime_type,payload,status,error)
    VALUES($1,$2,'synthetic-timeline','fixture.md','text/markdown',$3,'failed','synthetic terminal fixture')`,
  [jobId, tenant, Buffer.from("Synthetic fixture, never queued.")]);
  const details = { characters: 0, language: "und", ocr: { used: false } };
  await repository.recordEvent({ jobId, tenantId: tenant, stage: "text_extraction", status: "completed", durationMs: 0, details });
  const [stored] = await repository.listEvents(jobId, tenant, 100);
  assert.ok(stored); assert.equal(stored.durationMs, 0); assert.deepEqual(stored.details, details);
  assert.ok(stored.createdAt instanceof Date);
  assert.deepEqual(await repository.listEvents(jobId, randomUUID(), 100), []);
  try {
    await pool.query("UPDATE ingestion_job_events SET details=$4::jsonb WHERE id=$1 AND job_id=$2 AND tenant_id=$3",
      [stored.id, jobId, tenant, '["PRIVATE_EVENT_SENTINEL"]']);
    await assert.rejects(repository.listEvents(jobId, tenant, 100), (error: unknown) => error instanceof StoredRecordError &&
      error.code === "invalid_stored_record" && !String(error).includes("PRIVATE_EVENT_SENTINEL") && !("cause" in error));
  } finally {
    await pool.query("UPDATE ingestion_job_events SET details=$4::jsonb WHERE id=$1 AND job_id=$2 AND tenant_id=$3",
      [stored.id, jobId, tenant, JSON.stringify(details)]);
  }
  assert.deepEqual((await repository.listEvents(jobId, tenant, 100))[0]?.details, details);
  assert.equal((await pool.query("SELECT status FROM ingestion_jobs WHERE id=$1", [jobId])).rows[0]?.status, "failed");
});

test("PostgreSQL MCP ingestion status preserves nulls and rejects a negative stored count without losing scope", options, async (t) => {
  const { pool, tenant } = await fixture(t), reads = new PgMcpReadRepository(pool), id = randomUUID();
  await pool.query(`INSERT INTO ingestion_jobs(id,tenant_id,source,filename,mime_type,payload,status,progress,chunk_count)
    VALUES($1,$2,'synthetic-status','fixture.md','text/markdown',$3,'failed',0,0)`,
  [id, tenant, Buffer.from("Synthetic terminal status fixture, never queued.")]);
  const signal = new AbortController().signal;
  const status = await reads.getIngestionStatus(tenant, id, signal);
  assert.ok(status); assert.equal(status.documentId, null); assert.equal(status.chunkCount, 0);
  assert.equal(status.progress, 0); assert.ok(status.updatedAt instanceof Date);
  assert.equal(await reads.getIngestionStatus(randomUUID(), id, signal), null);
  try {
    await pool.query("UPDATE ingestion_jobs SET chunk_count=-1 WHERE id=$1 AND tenant_id=$2", [id, tenant]);
    await assert.rejects(reads.getIngestionStatus(tenant, id, signal), (error: unknown) =>
      error instanceof StoredRecordError && error.code === "invalid_stored_record" && !("cause" in error));
  } finally {
    await pool.query("UPDATE ingestion_jobs SET chunk_count=NULL WHERE id=$1 AND tenant_id=$2", [id, tenant]);
  }
  assert.equal((await reads.getIngestionStatus(tenant, id, signal))?.chunkCount, null);
  assert.equal((await pool.query("SELECT status FROM ingestion_jobs WHERE id=$1", [id])).rows[0]?.status, "failed");
});

test("PostgreSQL MCP source projections preserve SQL character clamps, unknown metadata and workspace isolation", options, async (t) => {
  const { pool, tenant } = await fixture(t), reads = new PgMcpReadRepository(pool), id = randomUUID();
  await pool.query("INSERT INTO documents(id,tenant_id,source,title,metadata) VALUES($1,$2,$3,$4,$5)",
    [id, tenant, "synthetic/source", "🧭".repeat(1010), { format: "custom", language: "es" }]);
  const signal = new AbortController().signal;
  const [source] = await reads.listSources(tenant, 10, signal);
  assert.ok(source); assert.equal(source.id, id); assert.equal(source.chunkCount, 0);
  assert.equal(source.title, "🧭".repeat(1001)); assert.equal(source.format, "custom");
  assert.equal(source.language, "es"); assert.ok(source.updatedAt instanceof Date);
  assert.deepEqual(await reads.listSources(randomUUID(), 10, signal), []);
  assert.equal(await reads.getDocument(randomUUID(), id, 2, signal), null);
  const document = await reads.getDocument(tenant, id, 2, signal);
  assert.deepEqual(document?.document, source); assert.deepEqual(document?.passages, []);
});

test("PostgreSQL full ingestion snapshots preserve byte/storage shape and reject corrupt counts before processing", options, async (t) => {
  const { pool, tenant } = await fixture(t), repository = new PgIngestionJobRepository(pool), id = randomUUID();
  const payload = Buffer.from("Synthetic terminal fixture, never queued.");
  await pool.query(`INSERT INTO ingestion_jobs(id,tenant_id,source,filename,mime_type,payload,status,progress,chunk_count,high_risk_chunks)
    VALUES($1,$2,'synthetic-full-job','fixture.md','text/markdown',$3,'failed',0,0,0)`, [id, tenant, payload]);
  const job = await repository.readForProcessing(id, tenant);
  assert.ok(job); assert.deepEqual(job.payload, payload); assert.equal(job.chunkCount, 0);
  assert.equal(job.highRiskChunks, 0); assert.equal(job.admissionAttempts, 0);
  assert.equal(await repository.readForProcessing(id, randomUUID()), null);
  assert.equal((await repository.list(tenant, 10))[0]?.chunkCount, 0);
  try {
    await pool.query("UPDATE ingestion_jobs SET high_risk_chunks=-1 WHERE id=$1 AND tenant_id=$2", [id, tenant]);
    await assert.rejects(repository.readForProcessing(id, tenant), StoredRecordError);
    await assert.rejects(repository.list(tenant, 10), StoredRecordError);
  } finally {
    await pool.query("UPDATE ingestion_jobs SET high_risk_chunks=NULL WHERE id=$1 AND tenant_id=$2", [id, tenant]);
  }
  assert.equal((await repository.readForProcessing(id, tenant))?.highRiskChunks, null);
  assert.equal((await repository.readForProcessing(id, tenant))?.status, "failed");
});

test("PostgreSQL preview projections keep current-source scope, ordered caps and repaired count semantics", options, async (t) => {
  const { pool, tenant } = await fixture(t), repository = new PgIngestionJobRepository(pool), job = randomUUID(), document = randomUUID();
  await pool.query("INSERT INTO documents(id,tenant_id,source,metadata) VALUES($1,$2,'synthetic-preview',$3)",
    [document, tenant, { ingestionJobId: job }]);
  await pool.query(`INSERT INTO ingestion_jobs(id,tenant_id,document_id,source,filename,mime_type,status,chunk_count)
    VALUES($1,$2,$3,'synthetic-preview','fixture.md','text/markdown','completed',NULL)`, [job, tenant, document]);
  const input = { jobId: job, tenantId: tenant };
  assert.deepEqual(await repository.previewPassages(input), { totalChunks: 0, passages: [] });
  const vector = `[1,${Array(1023).fill(0).join(",")}]`;
  for (const ordinal of [3, 1, 2, 0])
    await pool.query("INSERT INTO chunks(document_id,ordinal,content,embedding,metadata) VALUES($1,$2,$3,$4::vector,$5::jsonb)",
      [document, ordinal, `Synthetic passage ${ordinal}.`, vector,
        JSON.stringify(ordinal === 0 ? { security: { promptInjectionRisk: "low", signals: [] }, language: "es", ocr: { used: true } } : ["unknown legacy metadata"])]);
  const preview = await repository.previewPassages(input);
  assert.ok(preview); assert.equal(preview.totalChunks, 4); assert.deepEqual(preview.passages.map(({ ordinal }) => ordinal), [0, 1, 2]);
  assert.equal(preview.passages[0]?.security.promptInjectionRisk, "low");
  assert.equal(preview.passages[1]?.security.promptInjectionRisk, "high");
  assert.equal(await repository.previewPassages({ ...input, tenantId: randomUUID() }), null);
  try {
    await pool.query("UPDATE ingestion_jobs SET chunk_count=-1 WHERE id=$1 AND tenant_id=$2", [job, tenant]);
    await assert.rejects(repository.previewPassages(input), StoredRecordError);
  } finally { await pool.query("UPDATE ingestion_jobs SET chunk_count=NULL WHERE id=$1 AND tenant_id=$2", [job, tenant]); }
  assert.equal((await repository.previewPassages(input))?.totalChunks, 4);
  await pool.query("UPDATE documents SET metadata='{}'::jsonb WHERE id=$1 AND tenant_id=$2", [document, tenant]);
  assert.equal(await repository.previewPassages(input), null, "An old job does not preview a replacement document.");
});

test("PostgreSQL original projections preserve legacy/private alternatives and the indexed-revision predicate", options, async (t) => {
  const { pool, tenant } = await fixture(t), repository = new PgIngestionJobRepository(pool), job = randomUUID(), document = randomUUID();
  const payload = Buffer.from("Synthetic original bytes, never dispatched.");
  await pool.query("INSERT INTO documents(id,tenant_id,source,metadata) VALUES($1,$2,'synthetic-original',$3)",
    [document, tenant, { ingestionJobId: job }]);
  await pool.query(`INSERT INTO ingestion_jobs(id,tenant_id,document_id,source,filename,mime_type,payload,status)
    VALUES($1,$2,$3,'synthetic-original','🧭 fixture.pdf','custom/legacy',$4,'completed')`, [job, tenant, document, payload]);
  const input = { documentId: document, tenantId: tenant }, original = await repository.findIndexedOriginal(input);
  assert.ok(original); assert.deepEqual(original.payload, payload); assert.equal(original.storagePath, null);
  assert.equal(original.filename, "🧭 fixture.pdf"); assert.equal(original.mimeType, "custom/legacy");
  assert.equal(await repository.findIndexedOriginal({ ...input, tenantId: randomUUID() }), null);
  await pool.query("UPDATE ingestion_jobs SET payload=NULL,storage_path='synthetic-private/reference' WHERE id=$1 AND tenant_id=$2", [job, tenant]);
  assert.deepEqual(await repository.findIndexedOriginal(input), { filename: "🧭 fixture.pdf", mimeType: "custom/legacy", payload: null, storagePath: "synthetic-private/reference" });
  await pool.query("UPDATE documents SET metadata='{}'::jsonb WHERE id=$1 AND tenant_id=$2", [document, tenant]);
  assert.equal(await repository.findIndexedOriginal(input), null, "An old original does not follow a replacement document.");
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
