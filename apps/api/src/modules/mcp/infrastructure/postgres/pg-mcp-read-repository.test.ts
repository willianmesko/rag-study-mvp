import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { PgMcpReadRepository } from "./pg-mcp-read-repository.js";

const tenantId = "a7f8f2cb-016d-44c6-acba-14c31823caa0";
const documentId = "f649331e-f5d4-4cda-9534-ff4c76810e25";

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
