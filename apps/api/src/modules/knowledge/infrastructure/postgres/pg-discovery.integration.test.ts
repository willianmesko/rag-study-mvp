import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { ExistingIngestionSourceError } from "../../../ingestion/application/ports/ingestion-job-repository.js";
import { PgDemoLibraryRepository } from "./pg-demo-library-repository.js";
import { PgDocumentRepository } from "./pg-document-repository.js";
import { PgIngestionJobRepository } from "../../../ingestion/infrastructure/postgres/pg-ingestion-job-repository.js";

const databaseUrl = process.env.MCP_TEST_DATABASE_URL;

test("PostgreSQL isolates filtered discovery and serializes replayed demo imports", { skip: !databaseUrl, timeout: 30_000 }, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl!).hostname), "Use a disposable local database.");
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const tenantId = randomUUID();
  const otherTenant = randomUUID();
  const documents = new PgDocumentRepository(pool, 1_024);
  const jobs = new PgIngestionJobRepository(pool);
  const libraries = new PgDemoLibraryRepository(pool);
  t.after(async () => {
    try {
      await pool.query("DELETE FROM ingestion_jobs WHERE tenant_id=ANY($1::uuid[])", [[tenantId, otherTenant]]);
      await pool.query("DELETE FROM documents WHERE tenant_id=ANY($1::uuid[])", [[tenantId, otherTenant]]);
      await pool.query("DELETE FROM tenants WHERE id=ANY($1::uuid[])", [[tenantId, otherTenant]]);
    }
    finally { await pool.end(); }
  });
  await pool.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Discovery fixture'),($3,$4,'Other discovery fixture')",
    [tenantId, `discovery-${tenantId}`, otherTenant, `discovery-${otherTenant}`]);

  await t.test("two concurrent seed requests create one job; another tenant keeps its own job", async () => {
    const input = { tenantId, source: "demo/concurrent", title: "Safe fixture", filename: "example.md", mimeType: "text/markdown", payload: Buffer.from("# Example\nApproved synthetic content."), storagePath: null };
    const outcomes = await Promise.allSettled([jobs.enqueue(input, { onlyIfMissing: true }), jobs.enqueue(input, { onlyIfMissing: true })]);
    assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
    const rejected = outcomes.find((item) => item.status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof ExistingIngestionSourceError);
    const other = await jobs.enqueue({ ...input, tenantId: otherTenant }, { onlyIfMissing: true });
    const firstState = (await libraries.sourceStates(tenantId, [input.source]))[0]!;
    const otherState = (await libraries.sourceStates(otherTenant, [input.source]))[0]!;
    assert.equal(firstState.state, "queued"); assert.equal(otherState.jobId, other.id);
    assert.notEqual(firstState.jobId, other.id);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM ingestion_jobs WHERE tenant_id=$1 AND source=$2", [tenantId, input.source])).rows[0].count, 1);
  });

  await t.test("a source collision preserves the existing document and a missing historical source can be imported again", async () => {
    const source = "demo/preserve-existing";
    const inserted = await pool.query<{ id: string }>("INSERT INTO documents(tenant_id,source,title,metadata) VALUES($1,$2,'Existing material','{\"original\":true}') RETURNING id", [tenantId, source]);
    const input = { tenantId, source, title: "Replacement not allowed", filename: "fixture.md", mimeType: "text/markdown", payload: Buffer.from("# Synthetic sample"), storagePath: null };
    await assert.rejects(jobs.enqueue(input, { onlyIfMissing: true }), (error) => error instanceof ExistingIngestionSourceError && error.state === "ready" && error.documentId === inserted.rows[0]!.id);
    const preserved = (await pool.query("SELECT title, metadata FROM documents WHERE id=$1", [inserted.rows[0]!.id])).rows[0];
    assert.equal(preserved.title, "Existing material"); assert.deepEqual(preserved.metadata, { original: true });
    const old = await jobs.enqueue({ ...input, source: "demo/reimport" });
    await pool.query("UPDATE ingestion_jobs SET status='completed', progress=100 WHERE id=$1", [old.id]);
    assert.equal((await libraries.sourceStates(tenantId, ["demo/reimport"]))[0]!.state, "missing");
    const fresh = await jobs.enqueue({ ...input, source: "demo/reimport" }, { onlyIfMissing: true });
    assert.notEqual(fresh.id, old.id);
    await jobs.fail(fresh.id, "fixture_failure");
    assert.equal((await libraries.sourceStates(tenantId, ["demo/reimport"]))[0]!.state, "failed");
    assert.ok(await jobs.enqueue({ ...input, source: "demo/reimport" }, { onlyIfMissing: true }));
  });

  await t.test("filters apply before the result limit, use inclusive UTC days, and preserve tenant scope", async () => {
    const bulk = Array.from({ length: 125 }, (_, index) => ({ source: `bulk/${index}`, title: `Bulk ${index}`, metadata: { format: "text", language: "en" }, updated_at: "2026-10-01T12:00:00Z" }));
    await pool.query(`INSERT INTO documents(tenant_id,source,title,metadata,updated_at)
      SELECT $1,x.source,x.title,x.metadata,x.updated_at::timestamptz FROM jsonb_to_recordset($2::jsonb)
      AS x(source text,title text,metadata jsonb,updated_at text)`, [tenantId, JSON.stringify(bulk)]);
    const target = (await pool.query<{ id: string }>(`INSERT INTO documents(tenant_id,source,title,metadata,updated_at)
      VALUES($1,'demo/owner-100%','Owner''s 100% procedure','{"format":"markdown","language":"pt","sectionCount":2}','2026-01-31T23:59:59.999Z') RETURNING id`, [tenantId])).rows[0]!;
    await pool.query(`INSERT INTO documents(tenant_id,source,title,metadata,updated_at) VALUES
      ($1,'demo/other','Owner''s 100% procedure','{"format":"markdown","language":"pt"}','2026-01-31T12:00:00Z'),
      ($2,'demo/tomorrow','Owner''s 100% procedure','{"format":"markdown","language":"pt"}','2026-02-01T00:00:00Z')`, [otherTenant, tenantId]);
    assert.ok(!(await documents.list(tenantId, 100)).some(({ id }) => id === target.id));
    const filtered = await documents.list(tenantId, 100, { q: "Owner's 100%", source: "demo/", language: "pt", format: "markdown", from: "2026-01-31", to: "2026-01-31" });
    assert.deepEqual(filtered.map(({ id }) => id), [target.id]);
    assert.equal(filtered[0]!.sectionCount, 2);
    assert.deepEqual(await documents.list(otherTenant, 100, { documentId: target.id }), []);
    assert.deepEqual(await documents.list(tenantId, 100, { source: "%' OR TRUE --" }), []);
    assert.equal((await libraries.sourceStates(otherTenant, ["demo/owner-100%"]))[0]!.state, "missing");
  });
});
