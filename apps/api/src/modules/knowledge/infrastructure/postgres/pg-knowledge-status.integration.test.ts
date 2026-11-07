import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { PgKnowledgeStatusRepository } from "./pg-knowledge-status-repository.js";

const url = process.env.MCP_TEST_DATABASE_URL;
test("knowledge readiness counts real index entries, pending work and failures within one workspace", { skip: !url, timeout: 30_000 }, async (t) => {
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url!).hostname), "Use a disposable local database.");
  const pool = new Pool({ connectionString: url, max: 2 });
  const repo = new PgKnowledgeStatusRepository(pool);
  const tenant = randomUUID(), other = randomUUID();
  t.after(async () => {
    try {
      await pool.query("DELETE FROM ingestion_jobs WHERE tenant_id=ANY($1::uuid[])", [[tenant, other]]);
      await pool.query("DELETE FROM documents WHERE tenant_id=ANY($1::uuid[])", [[tenant, other]]);
      await pool.query("DELETE FROM tenants WHERE id=ANY($1::uuid[])", [[tenant, other]]);
    } finally { await pool.end(); }
  });
  for (const id of [tenant, other]) await pool.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Knowledge fixture')", [id, `knowledge-${id}`]);
  const empty = { indexedDocuments: 0, passages: 0, processingJobs: 0, failedJobs: 0 };
  assert.deepEqual(await repo.get(tenant), empty);

  const row = await pool.query<{ id: string }>("INSERT INTO documents(tenant_id,source) VALUES($1,'private-source') RETURNING id", [tenant]);
  const document = row.rows[0]!.id;
  assert.deepEqual(await repo.get(tenant), empty, "A document row with no passages must not unlock chat.");
  const vector = `[1,${Array(1023).fill(0).join(",")}]`;
  await pool.query("INSERT INTO chunks(document_id,ordinal,content,embedding) VALUES($1,0,'First private passage',$2::vector),($1,1,'Second private passage',$2::vector)", [document, vector]);
  assert.deepEqual(await repo.get(tenant), { ...empty, indexedDocuments: 1, passages: 2 }, "CLI imports can be ready without an upload job.");
  // More than the paginated list's 30 entries, with the only active job oldest.
  await pool.query(`INSERT INTO ingestion_jobs(tenant_id,source,filename,mime_type,payload,status,created_at)
    SELECT $1, 'fixture-'||i, 'private-name.txt','text/plain',decode('78','hex'),CASE WHEN i=0 THEN 'queued' WHEN i=1 THEN 'processing' WHEN i=2 THEN 'failed' ELSE 'completed' END,
      NOW()+i*interval '1 second' FROM generate_series(0,35) AS i`, [tenant]);
  await pool.query("INSERT INTO ingestion_jobs(tenant_id,source,filename,mime_type,payload,status,error) VALUES($1,'other-private-source','secret.txt','text/plain',decode('78','hex'),'failed','secret-error')", [other]);
  assert.deepEqual(await repo.get(tenant), { indexedDocuments: 1, passages: 2, processingJobs: 2, failedJobs: 1 });
  assert.deepEqual(await repo.get(other), { ...empty, failedJobs: 1 });
  await pool.query("DELETE FROM documents WHERE id=$1", [document]);
  assert.deepEqual(await repo.get(tenant), { ...empty, processingJobs: 2, failedJobs: 1 });
  assert.doesNotMatch(JSON.stringify(await repo.get(tenant)), /private|secret|source|filename|error/);
});
