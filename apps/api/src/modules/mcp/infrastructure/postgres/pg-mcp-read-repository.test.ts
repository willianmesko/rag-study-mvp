import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { PgMcpReadRepository } from "./pg-mcp-read-repository.js";
import { StoredRecordError } from "../../../../platform/database/stored-record.js";

const tenantId = "a7f8f2cb-016d-44c6-acba-14c31823caa0";
const documentId = "f649331e-f5d4-4cda-9534-ff4c76810e25";

function rowFixture(rows: unknown[], table: "evaluation_runs" | "ingestion_jobs" | "documents" = "evaluation_runs") {
  const queries: Array<{ sql: string; params: unknown[] }> = [], releases: unknown[] = [];
  const client = { async query(sql: string, params: unknown[] = []) {
    queries.push({ sql, params });
    return { rows: sql.includes("FROM public." + table) ? rows : [], rowCount: sql.includes("pg_catalog.pg_settings") ? 3 : 0 };
  }, on() {}, removeListener() {}, release(value?: unknown) { releases.push(value); } };
  const pool = { connect: async () => client } as unknown as Pool;
  return { repository: new PgMcpReadRepository(pool), queries, releases };
}
const qualityRow = () => ({ id: documentId, dataset_name: "fixture", dataset_version: "1", total_cases: 4,
  hit_rate: "0.750000", mean_reciprocal_rank: "0.625000", faithfulness: null, context_precision: "0.000000",
  injection_pass_rate: "1.000000", passed: false, created_at: new Date("2026-11-08T00:00:00Z") });

const ingestionRow = () => ({ id: documentId, document_id: null, status: "queued", progress: 0,
  chunk_count: null, updated_at: new Date("2026-11-08T00:00:00Z") });
const sourceRow = () => ({ id: documentId, source: "synthetic/source", title: null,
  format: null, language: null, chunk_count: 0, updated_at: new Date("2026-11-08T00:00:00Z") });
test("MCP source rows retain SQL-clamped Unicode, optional metadata and zero counts across reads", async () => {
  const row = { ...sourceRow(), title: "🧭".repeat(1001), format: "custom", language: "es" };
  const { repository, queries, releases } = rowFixture([row], "documents");
  const sources = await repository.listSources(tenantId, 10, new AbortController().signal);
  assert.equal(sources[0]?.chunkCount, 0); assert.equal(sources[0]?.title, row.title);
  assert.equal(sources[0]?.format, "custom"); assert.equal(sources[0]?.language, "es");
  assert.ok(sources[0]?.updatedAt instanceof Date);
  const document = await repository.getDocument(tenantId, documentId, 2, new AbortController().signal);
  assert.deepEqual(document?.document, sources[0]); assert.deepEqual(document?.passages, []);
  assert.deepEqual(queries.find(({ sql }) => sql.includes("LIMIT $2"))?.params, [tenantId, 10]);
  assert.equal(releases.length, 2);
});
test("invalid MCP source pages rollback instead of fabricating labels, counts or dates", async () => {
  for (const patch of [{ id: "PRIVATE_ID" }, { source: null }, { title: ["PRIVATE_TITLE"] },
    { format: 1 }, { language: false }, { chunk_count: -1 }, { chunk_count: "0" },
    { updated_at: new Date("invalid") }]) {
    for (const detail of [false, true]) {
      const { repository, queries, releases } = rowFixture([{ ...sourceRow(), ...patch }], "documents");
      await assert.rejects(detail
        ? repository.getDocument(tenantId, documentId, 2, new AbortController().signal)
        : repository.listSources(tenantId, 10, new AbortController().signal), (error: unknown) =>
        error instanceof StoredRecordError && !String(error).includes("PRIVATE_") && !("cause" in error));
      assert.equal(queries.at(-1)?.sql, "ROLLBACK"); assert.equal(releases.length, 1);
    }
  }
  await assert.rejects(rowFixture(Array.from({ length: 11 }, sourceRow), "documents").repository
    .listSources(tenantId, 10, new AbortController().signal), StoredRecordError);
});
test("invalid internal MCP source limits fail before a connection is acquired", () => {
  let checkouts = 0;
  const pool = { connect: async () => { checkouts++; throw new Error("Unexpected checkout."); } } as unknown as Pool;
  const repository = new PgMcpReadRepository(pool);
  for (const limit of [0, -1, 11, 1.5, NaN, Infinity])
    assert.throws(() => repository.listSources(tenantId, limit, new AbortController().signal), /Invalid MCP source limit/);
  assert.equal(checkouts, 0);
});
test("MCP ingestion status preserves physical dates, zero/null progress and its explicit scope", async () => {
  for (const patch of [{}, { status: "completed", progress: 100, chunk_count: 0, document_id: documentId }]) {
    const row = { ...ingestionRow(), ...patch };
    const { repository, queries, releases } = rowFixture([row], "ingestion_jobs");
    const status = await repository.getIngestionStatus(tenantId, documentId, new AbortController().signal);
    assert.deepEqual(status, { id: documentId, documentId: row.document_id, status: row.status,
      progress: row.progress, chunkCount: row.chunk_count, updatedAt: row.updated_at });
    assert.deepEqual(queries.find(({ sql }) => sql.includes("FROM public.ingestion_jobs"))?.params, [tenantId, documentId]);
    assert.equal(queries.at(-1)?.sql, "COMMIT"); assert.equal(releases.length, 1);
  }
});
test("an absent MCP ingestion job remains null and releases its read transaction", async () => {
  const { repository, queries, releases } = rowFixture([], "ingestion_jobs");
  assert.equal(await repository.getIngestionStatus(tenantId, documentId, new AbortController().signal), null);
  assert.equal(queries.at(-1)?.sql, "COMMIT"); assert.equal(releases.length, 1);
});
test("invalid MCP ingestion counts/dates rollback without raw stored values or serializer errors", async () => {
  for (const patch of [{ chunk_count: -1 }, { chunk_count: "0" }, { chunk_count: 1.5 }, { progress: null },
    { progress: -1 }, { progress: 101 }, { progress: 1.5 }, { progress: NaN }, { status: "PRIVATE_STATUS" },
    { id: "PRIVATE_ID" }, { document_id: "PRIVATE_DOCUMENT" }, { updated_at: new Date("invalid") },
    { updated_at: "PRIVATE_DATE" }]) {
    const { repository, queries, releases } = rowFixture([{ ...ingestionRow(), ...patch }], "ingestion_jobs");
    await assert.rejects(repository.getIngestionStatus(tenantId, documentId, new AbortController().signal), (error: unknown) =>
      error instanceof StoredRecordError && error.code === "invalid_stored_record" &&
      !String(error).includes("PRIVATE_") && !("cause" in error));
    assert.equal(queries.at(-1)?.sql, "ROLLBACK"); assert.equal(releases.length, 1);
  }
});

test("MCP quality rows share decimal decoding and preserve unknown metrics, real zero and false", async () => {
  const { repository, queries, releases } = rowFixture([qualityRow()]);
  const [report] = await repository.getQualityReport(tenantId, 5, new AbortController().signal);
  assert.ok(report); assert.equal(report.hitRate, 0.75); assert.equal(report.meanReciprocalRank, 0.625);
  assert.equal(report.faithfulness, null); assert.equal(report.contextPrecision, 0); assert.equal(report.passed, false);
  assert.equal(report.createdAt.toISOString(), "2026-11-08T00:00:00.000Z");
  assert.deepEqual(queries.find(({ sql }) => sql.includes("FROM public.evaluation_runs"))?.params, [tenantId, 5]);
  assert.equal(queries.at(-1)?.sql, "COMMIT"); assert.equal(releases.length, 1);
});
test("malformed MCP metrics rollback and release without fabricated zero or stored-value diagnostics", async () => {
  for (const patch of [{ hit_rate: null }, { hit_rate: "" }, { hit_rate: " " }, { hit_rate: "NaN" }, { hit_rate: "Infinity" },
    { hit_rate: "1.00001" }, { hit_rate: -0.1 }, { context_precision: "" }, { faithfulness: -1 },
    { passed: "true" }, { total_cases: 1.5 }, { created_at: new Date("invalid") }, { dataset_name: ["PRIVATE_SENTINEL"] }]) {
    const { repository, queries, releases } = rowFixture([{ ...qualityRow(), ...patch }]);
    await assert.rejects(repository.getQualityReport(tenantId, 5, new AbortController().signal), (error: unknown) =>
      error instanceof StoredRecordError && error.code === "invalid_stored_record" && !String(error).includes("PRIVATE_SENTINEL") && !("cause" in error));
    assert.equal(queries.at(-1)?.sql, "ROLLBACK"); assert.ok(!queries.some(({ sql }) => sql === "COMMIT"));
    assert.equal(releases.length, 1);
  }
  await assert.rejects(rowFixture(Array.from({ length: 11 }, qualityRow)).repository.getQualityReport(tenantId, 10, new AbortController().signal), StoredRecordError);
});
test("invalid internal quality limits fail before checking out a connection", () => {
  let checkouts = 0;
  const pool = { connect: async () => { checkouts++; throw new Error("Unexpected checkout."); } } as unknown as Pool;
  const repository = new PgMcpReadRepository(pool);
  for (const limit of [0, -1, 11, 1.5, NaN, Infinity])
    assert.throws(() => repository.getQualityReport(tenantId, limit, new AbortController().signal), /Invalid MCP quality-report limit/);
  assert.equal(checkouts, 0);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test("MCP reads use a bounded transaction and scope every data query", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const releases: Array<boolean | undefined> = [];
  const fakePool = { connect: async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return { rows: [], rowCount: sql.includes("pg_catalog.pg_settings") ? 3 : 0 };
    },
    on: () => {},
    removeListener: () => {},
    release: (destroy?: boolean) => { releases.push(destroy); }
  }) } as unknown as Pool;
  const reads = new PgMcpReadRepository(fakePool, 1_250);
  const { signal } = new AbortController();

  assert.deepEqual(await reads.listSources(tenantId, 10, signal), []);
  assert.equal(await reads.getIngestionStatus(tenantId, documentId, signal), null);
  assert.deepEqual(await reads.getQualityReport(tenantId, 10, signal), []);
  assert.equal(await reads.getDocument(tenantId, documentId, 2, signal), null);
  assert.deepEqual(await reads.search(tenantId, "policy", 2, signal), []);

  for (let offset = 0; offset < queries.length; offset += 4) {
    const [begin, guard, data, commit] = queries.slice(offset, offset + 4);
    assert.equal(begin?.sql, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.match(guard?.sql ?? "", /statement_timeout/);
    assert.match(guard?.sql ?? "", /setting\.setting::bigint/);
    assert.deepEqual(guard?.params, [1250, 500, 1250, true]);
    assert.match(data?.sql ?? "", /tenant_id = \$1/);
    assert.equal(data?.params[0], tenantId);
    assert.equal(commit?.sql, "COMMIT");
  }
  assert.equal(queries.length, 20);
  assert.deepEqual(releases, Array(5).fill(undefined));
});

test("aborting an in-flight MCP query discards the connection once and skips commit", async () => {
  const controller = new AbortController();
  const started = deferred<void>();
  const pending = deferred<{ rows: unknown[] }>();
  const queried: string[] = [];
  const releases: Array<boolean | undefined> = [];
  const fakePool = { connect: async () => ({
    query: async (sql: string) => {
      queried.push(sql);
      if (sql.includes("public.documents")) {
        started.resolve();
        return pending.promise;
      }
      return { rows: [], rowCount: sql.includes("pg_catalog.pg_settings") ? 3 : 0 };
    },
    on: () => {},
    removeListener: () => {},
    release: (destroy?: boolean) => {
      releases.push(destroy);
      if (destroy) pending.reject(new Error("Connection terminated"));
    }
  }) } as unknown as Pool;
  const reads = new PgMcpReadRepository(fakePool);
  const result = reads.listSources(tenantId, 2, controller.signal);
  await started.promise;
  const reason = new Error("Host cancelled");
  controller.abort(reason);
  await assert.rejects(result, (error) => error === reason);
  assert.deepEqual(releases, [true]);
  assert.equal(queried.includes("COMMIT"), false);
});

test("a cancelled pool checkout is released without submitting queries", async () => {
  const controller = new AbortController();
  const acquired = deferred<{ query: () => never; release: (destroy?: boolean) => void }>();
  const releases: Array<boolean | undefined> = [];
  const fakePool = { connect: () => acquired.promise } as unknown as Pool;
  const reads = new PgMcpReadRepository(fakePool);
  const result = reads.listSources(tenantId, 2, controller.signal);
  controller.abort();
  acquired.resolve({
    query: () => assert.fail("Cancelled work must not reach the database."),
    release: (destroy) => { releases.push(destroy); }
  });
  await assert.rejects(result, { name: "AbortError" });
  assert.deepEqual(releases, [undefined]);
});
