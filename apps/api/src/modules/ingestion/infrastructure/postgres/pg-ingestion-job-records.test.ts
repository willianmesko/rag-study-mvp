import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { PgIngestionJobRepository } from "./pg-ingestion-job-repository.js";
import { StoredRecordError } from "../../../../platform/database/stored-record.js";

const tenantId = "20000000-0000-4000-8000-000000000001", jobId = "30000000-0000-4000-8000-000000000001";
const row = () => ({ id: jobId, tenant_id: tenantId, document_id: null, source: "synthetic/source",
  title: null, filename: "fixture.md", mime_type: "text/markdown", payload: Buffer.from("PRIVATE_SYNTHETIC_FILE"),
  storage_path: null, status: "queued", progress: 0, error: null, chunk_count: null, high_risk_chunks: null,
  created_at: new Date("2026-11-08T00:00:00Z"), updated_at: new Date("2026-11-08T00:00:00Z") });
function fixture(rows: unknown[]) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const pool = { async query(sql: string, values: unknown[]) { queries.push({ sql, values }); return { rows }; } } as unknown as Pool;
  return { repository: new PgIngestionJobRepository(pool), queries };
}
test("processing snapshots preserve original Buffer identity, nullable metadata and absent legacy admission count", async () => {
  const saved = row(), { repository, queries } = fixture([saved]);
  const job = await repository.readForProcessing(jobId, tenantId);
  assert.ok(job); assert.equal(job.payload, saved.payload); assert.equal(job.admissionAttempts, 0);
  assert.equal(job.chunkCount, null); assert.equal(job.highRiskChunks, null); assert.equal(job.documentId, null);
  assert.equal(job.title, null); assert.equal(job.storagePath, null); assert.equal(job.progress, 0);
  assert.ok(job.createdAt instanceof Date); assert.ok(job.updatedAt instanceof Date);
  assert.deepEqual(queries[0]?.values, [jobId, tenantId]);
});
test("ingestion lists omit file bytes in SQL while retaining valid zero counts and the internal null placeholder", async () => {
  const { payload: _payload, ...withoutFile } = row();
  const { repository, queries } = fixture([{ ...withoutFile, admission_attempts: 2, status: "completed",
    progress: 100, chunk_count: 0, high_risk_chunks: 0, document_id: jobId }]);
  const [job] = await repository.list(tenantId, 10);
  assert.ok(job); assert.equal(job.chunkCount, 0); assert.equal(job.highRiskChunks, 0);
  assert.equal(job.admissionAttempts, 2); assert.equal(job.progress, 100);
  assert.equal((job as { payload?: unknown }).payload, null);
  assert.doesNotMatch(queries[0]!.sql.split(/\bFROM\b/i)[0]!, /\bpayload\b/i);
  assert.deepEqual(queries[0]?.values, [tenantId, 10]);
});
test("corrupt ingestion snapshots fail with fixed diagnostics and never reflect private file data", async () => {
  for (const patch of [{ chunk_count: -1 }, { high_risk_chunks: -1 }, { chunk_count: "0" },
    { progress: -1 }, { progress: 100.5 }, { status: "PRIVATE_STATE" }, { tenant_id: "PRIVATE_TENANT" },
    { admission_attempts: null }, { admission_attempts: -1 }, { admission_attempts: 1.5 },
    { updated_at: new Date("invalid") }, { created_at: "PRIVATE_DATE" }, { payload: "PRIVATE_FILE" },
    { payload: new Uint8Array([1, 2]) }, { source: null }])
    await assert.rejects(fixture([{ ...row(), ...patch }]).repository.readForProcessing(jobId, tenantId),
      (error: unknown) => error instanceof StoredRecordError && error.code === "invalid_stored_record" &&
        !String(error).includes("PRIVATE_") && !JSON.stringify(error).includes("PRIVATE_") && !("cause" in error));
});
test("private-storage snapshots and absence retain their existing semantics", async () => {
  const job = await fixture([{ ...row(), payload: null, storage_path: "synthetic-private/original", admission_attempts: 0 }])
    .repository.readForProcessing(jobId, tenantId);
  assert.ok(job); assert.equal(job.payload, null); assert.equal(job.storagePath, "synthetic-private/original");
  assert.equal(job.admissionAttempts, 0);
  assert.equal(await fixture([]).repository.readForProcessing(jobId, tenantId), null);
  assert.deepEqual(await fixture([]).repository.list(tenantId, 10), []);
});
