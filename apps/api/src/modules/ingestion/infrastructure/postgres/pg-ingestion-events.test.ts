import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { PgIngestionJobRepository } from "./pg-ingestion-job-repository.js";
import { StoredRecordError } from "../../../../platform/database/stored-record.js";

const tenantId = "20000000-0000-4000-8000-000000000001", jobId = "30000000-0000-4000-8000-000000000001";
const event = () => ({ id: "40000000-0000-4000-8000-000000000001", job_id: jobId, stage: "text_extraction",
  status: "completed", duration_ms: 0, details: { characters: 0, language: "und", ocr: { used: false, notes: [] } },
  created_at: new Date("2026-11-08T00:00:00Z") });
function fixture(rows: unknown[]) {
  const queries: Array<{ sql: string; parameters: unknown[] }> = [];
  const pool = { query: async (sql: string, parameters: unknown[]) => { queries.push({ sql, parameters }); return { rows }; } } as unknown as Pool;
  return { repository: new PgIngestionJobRepository(pool), queries };
}
test("timeline rows preserve structured detail, event order, scope and zero versus unknown timing", async () => {
  const first = event(), second = { ...event(), id: "40000000-0000-4000-8000-000000000002", duration_ms: null };
  const { repository, queries } = fixture([first, second]);
  const rows = await repository.listEvents(jobId, tenantId, 100);
  assert.deepEqual(rows.map(({ id }) => id), [first.id, second.id]);
  assert.equal(rows[0]?.durationMs, 0); assert.equal(rows[1]?.durationMs, null);
  assert.deepEqual(rows[0]?.details, first.details); assert.ok(rows[0]?.createdAt instanceof Date);
  assert.equal(rows[0]?.jobId, jobId);
  assert.deepEqual(queries[0]?.parameters, [jobId, tenantId, 100]);
  assert.match(queries[0]!.sql, /WHERE job_id = \$1 AND tenant_id = \$2 ORDER BY created_at ASC LIMIT \$3/);
});
test("corrupt event JSON, dates, states and identifiers fail without reflecting saved detail", async () => {
  for (const patch of [{ details: ["PRIVATE_EVENT_SENTINEL"] }, { details: null }, { details: "PRIVATE_EVENT_SENTINEL" },
    { created_at: new Date("invalid") }, { duration_ms: "0" }, { duration_ms: -1 }, { duration_ms: 0.5 },
    { status: "PRIVATE_EVENT_SENTINEL" }, { stage: "" }, { id: "invalid" }, { job_id: "invalid" }]) {
    await assert.rejects(fixture([{ ...event(), ...patch }]).repository.listEvents(jobId, tenantId, 100), (error: unknown) =>
      error instanceof StoredRecordError && error.code === "invalid_stored_record" &&
      !String(error).includes("PRIVATE_EVENT_SENTINEL") && !JSON.stringify(error).includes("PRIVATE_EVENT_SENTINEL") && !("cause" in error));
  }
});
test("an absent timeline stays empty and a corrupt page is not silently reported as complete", async () => {
  assert.deepEqual(await fixture([]).repository.listEvents(jobId, tenantId, 100), []);
  await assert.rejects(fixture([event(), { ...event(), details: [] }]).repository.listEvents(jobId, tenantId, 100), StoredRecordError);
});
