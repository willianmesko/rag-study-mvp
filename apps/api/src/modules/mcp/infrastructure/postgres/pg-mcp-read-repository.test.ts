import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { PgMcpReadRepository } from "./pg-mcp-read-repository.js";
import { StoredRecordError } from "../../../../platform/database/stored-record.js";

const tenantId = "a7f8f2cb-016d-44c6-acba-14c31823caa0";
const documentId = "f649331e-f5d4-4cda-9534-ff4c76810e25";

function qualityFixture(rows: unknown[]) {
  const queries: Array<{ sql: string; params: unknown[] }> = [], releases: unknown[] = [];
  const client = { async query(sql: string, params: unknown[] = []) {
    queries.push({ sql, params });
    return { rows: sql.includes("FROM public.evaluation_runs") ? rows : [], rowCount: sql.includes("pg_catalog.pg_settings") ? 3 : 0 };
  }, on() {}, removeListener() {}, release(value?: unknown) { releases.push(value); } };
  const pool = { connect: async () => client } as unknown as Pool;
  return { repository: new PgMcpReadRepository(pool), queries, releases };
}
const qualityRow = () => ({ id: documentId, dataset_name: "fixture", dataset_version: "1", total_cases: 4,
  hit_rate: "0.750000", mean_reciprocal_rank: "0.625000", faithfulness: null, context_precision: "0.000000",
  injection_pass_rate: "1.000000", passed: false, created_at: new Date("2026-11-08T00:00:00Z") });

test("MCP quality rows share decimal decoding and preserve unknown metrics, real zero and false", async () => {
  const { repository, queries, releases } = qualityFixture([qualityRow()]);
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
    const { repository, queries, releases } = qualityFixture([{ ...qualityRow(), ...patch }]);
    await assert.rejects(repository.getQualityReport(tenantId, 5, new AbortController().signal), (error: unknown) =>
      error instanceof StoredRecordError && error.code === "invalid_stored_record" && !String(error).includes("PRIVATE_SENTINEL") && !("cause" in error));
    assert.equal(queries.at(-1)?.sql, "ROLLBACK"); assert.ok(!queries.some(({ sql }) => sql === "COMMIT"));
    assert.equal(releases.length, 1);
  }
  await assert.rejects(qualityFixture(Array.from({ length: 11 }, qualityRow)).repository.getQualityReport(tenantId, 10, new AbortController().signal), StoredRecordError);
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
