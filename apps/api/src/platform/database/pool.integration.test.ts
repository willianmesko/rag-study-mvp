import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { createPostgresPool } from "./pool.js";

const databaseUrl = process.env.MCP_TEST_DATABASE_URL;
test("idle backend termination is handled and the pool replaces its failed connection", { skip: !databaseUrl }, async (t) => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Only a disposable loopback database is allowed.");
  const pool = createPostgresPool(databaseUrl!, 1), control = new Pool({ connectionString: databaseUrl!, max: 1 });
  const log = t.mock.method(console, "warn", () => {});
  try {
    const first = (await pool.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const failure = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Expected idle pool failure was not observed.")), 5_000);
      pool.once("error", () => { clearTimeout(timer); resolve(); });
    });
    await control.query("SELECT pg_terminate_backend($1)", [first]);
    await failure;
    const next = (await pool.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    assert.notEqual(next, first);
    assert.equal((await pool.query("SELECT 1 AS alive")).rows[0].alive, 1);
    assert.equal(log.mock.callCount(), 1);
    assert.ok(!JSON.stringify(log.mock.calls).includes(databaseUrl!));
  } finally { await pool.end(); await control.end(); }
});
