import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createPostgresPool } from "../database/pool.js";
import { withPostgresTransaction } from "../database/sql-boundary.js";
import { createShutdownCoordinator } from "./shutdown.js";

const databaseUrl = process.env.MCP_TEST_DATABASE_URL;

test("shutdown cancels a real SQL wait, rolls back interrupted work and closes the owned pool once", {
  skip: !databaseUrl, timeout: 15_000,
}, async (t) => {
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl!).hostname), "Use a disposable loopback database only.");
  const control = new Pool({ connectionString: databaseUrl, max: 1 });
  const pool = createPostgresPool(databaseUrl!, 1);
  const schema = `shutdown_${randomUUID().replaceAll("-", "")}`;
  let poolClosed = false;
  t.after(async () => {
    if (!poolClosed) await pool.end();
    try { await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await control.end(); }
  });
  await control.query(`CREATE SCHEMA ${schema}`);
  await control.query(`CREATE TABLE ${schema}.records(id int PRIMARY KEY)`);
  const pid = (await pool.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
  let work: Promise<unknown> | undefined;
  let closes = 0;
  const lifecycle = createShutdownCoordinator({
    timeoutMs: 1_000,
    stopBackground: () => {}, closeHttp: async () => {},
    drain: async () => { await Promise.allSettled([work]); },
    closeResources: async () => { closes++; await pool.end(); poolClosed = true; },
    flushTelemetry: async () => {},
  });
  work = withPostgresTransaction(pool, async (client) => {
    await client.query(`INSERT INTO ${schema}.records VALUES(1)`);
    await client.query("SELECT pg_sleep(10)");
  }, { workload: "retrieval", signal: lifecycle.signal });
  const rejected = assert.rejects(work, /Server shutdown/);
  await until(async () => (await control.query<{ active: boolean }>(
    "SELECT state='active' AND query LIKE '%pg_sleep%' AS active FROM pg_catalog.pg_stat_activity WHERE pid=$1", [pid],
  )).rows[0]?.active === true);
  const shutdown = lifecycle.shutdown("SIGTERM");
  assert.equal(lifecycle.shutdown("SIGTERM"), shutdown);
  assert.equal((await shutdown).outcome, "completed");
  await rejected;
  assert.equal(closes, 1);
  assert.equal(pool.totalCount, 0);
  await until(async () => (await control.query("SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid=$1", [pid])).rowCount === 0);
  assert.equal((await control.query<{ count: string }>(`SELECT count(*) FROM ${schema}.records`)).rows[0]!.count, "0");
});

async function until(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("The SQL shutdown fixture did not reach the expected state.");
}
