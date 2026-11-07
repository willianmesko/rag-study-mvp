import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createPostgresPool } from "./pool.js";
import { postgresDeadlineProfiles, withPostgresTransaction, type PostgresWorkload } from "./sql-boundary.js";
import { PgDocumentRepository } from "../../modules/knowledge/infrastructure/postgres/pg-document-repository.js";
import { SearchDocumentsUseCase } from "../../modules/knowledge/application/use-cases/search-documents.js";
import { PgMcpControls } from "../../modules/mcp/infrastructure/postgres/pg-mcp-controls.js";

const databaseUrl = process.env.MCP_TEST_DATABASE_URL;
const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
async function until(check: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await check()) return;
    await pause(10);
  }
  assert.fail("The expected bounded database state was not reached.");
}

test("PostgreSQL enforces workload limits, cancellation and reusable transaction cleanup", { skip: !databaseUrl, timeout: 40000 }, async (t) => {
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl!).hostname), "Only a disposable loopback database is allowed.");
  const schema = `sql_boundary_${randomUUID().replaceAll("-", "")}`;
  const control = new Pool({ connectionString: databaseUrl, max: 2 });
  await control.query(`CREATE SCHEMA ${schema}`);
  await control.query(`CREATE TABLE ${schema}.records(id int PRIMARY KEY,value int NOT NULL)`);
  await control.query(`INSERT INTO ${schema}.records VALUES(1,1)`);
  await control.query(`CREATE TABLE ${schema}.tenants(id uuid PRIMARY KEY)`);
  for (const name of ["tenant_memberships", "workspace_mcp_call_usage", "workspace_mcp_provider_usage", "workspace_mcp_provider_reservations"]) {
    await control.query(`CREATE TABLE ${schema}.${name} (LIKE public.${name} INCLUDING ALL)`);
  }
  const pools: Pool[] = [];
  const connection = (workload: PostgresWorkload = "runtime", extra = "") => {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema},public ${extra}`.trim());
    url.searchParams.set("application_name", `boundary-${randomUUID()}`);
    const pool = createPostgresPool(url.href, 1, workload);
    pools.push(pool);
    return pool;
  };
  t.after(async () => {
    await Promise.all(pools.map((pool) => pool.end()));
    try { await control.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await control.end(); }
  });
  const settings = async (pool: Pool) => Object.fromEntries((await pool.query<{ name: string; setting: string }>(
    "SELECT name,setting FROM pg_catalog.pg_settings WHERE name IN ('statement_timeout','lock_timeout','idle_in_transaction_session_timeout')",
  )).rows.map((row) => [row.name, Number(row.setting)]));

  await t.test("runtime defaults preserve effective stricter DSN deadlines", async () => {
    const runtime = connection();
    assert.deepEqual(await settings(runtime), { statement_timeout: 30000, lock_timeout: 3000, idle_in_transaction_session_timeout: 30000 });
    const strict = connection("runtime", "-c statement_timeout=100ms -c lock_timeout=40ms -c idle_in_transaction_session_timeout=250ms");
    assert.deepEqual(await settings(strict), { statement_timeout: 100, lock_timeout: 40, idle_in_transaction_session_timeout: 250 });
    await assert.rejects(strict.query("SELECT pg_sleep(10)"), { code: "57014" });
    assert.equal((await strict.query("SELECT 1 AS value")).rows[0].value, 1);
    await withPostgresTransaction(strict, async (client) => {
      const result = await client.query("SELECT current_setting('statement_timeout') AS statement,current_setting('lock_timeout') AS lock");
      assert.deepEqual(result.rows[0], { statement: "100ms", lock: "40ms" });
    }, { workload: "retrieval" });
    assert.deepEqual(await settings(strict), { statement_timeout: 100, lock_timeout: 40, idle_in_transaction_session_timeout: 250 });
  });

  await t.test("native statement timeout rolls back writes and returns a clean client", async () => {
    const pool = connection();
    const pid = (await pool.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await assert.rejects(withPostgresTransaction(pool, async (client) => {
      await client.query("UPDATE records SET value=99 WHERE id=1");
      await client.query("SELECT pg_sleep(10)");
    }, { limits: { statementMs: 100, lockMs: 50, idleTransactionMs: 500 } }), { code: "57014" });
    const result = await pool.query("SELECT pg_backend_pid() AS pid,value FROM records WHERE id=1");
    assert.deepEqual(result.rows[0], { pid, value: 1 });
    assert.equal(pool.totalCount, 1);
    assert.equal(pool.idleCount, 1);
  });

  await t.test("lock contention has its own shorter timeout and releases the failed transaction", async () => {
    const pool = connection(), blocker = await control.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(`UPDATE ${schema}.records SET value=value WHERE id=1`);
      await assert.rejects(withPostgresTransaction(pool, (client) => client.query("UPDATE records SET value=2 WHERE id=1"), {
        limits: { statementMs: 1000, lockMs: 75, idleTransactionMs: 1000 },
      }), { code: "55P03" });
      assert.equal((await pool.query("SELECT value FROM records WHERE id=1")).rows[0].value, 1);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    await withPostgresTransaction(pool, (client) => client.query("UPDATE records SET value=1 WHERE id=1"));
    assert.equal(pool.idleCount, 1);
  });

  await t.test("an in-flight caller abort closes the client, rolls back and replaces it", async () => {
    const pool = connection(), controller = new AbortController();
    const pid = (await pool.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const work = withPostgresTransaction(pool, async (client) => {
      await client.query("UPDATE records SET value=42 WHERE id=1");
      await client.query("SELECT pg_sleep(10)");
    }, { workload: "retrieval", signal: controller.signal });
    // Observe actual PostgreSQL execution before aborting, not a timer racing
    // connection startup. No request is cancelled before it reaches the server.
    await until(async () => (await control.query("SELECT state='active' AND query LIKE '%pg_sleep%' AS sleeping FROM pg_catalog.pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.sleeping === true);
    const reason = new Error("Caller cancelled the fixture.");
    controller.abort(reason);
    await assert.rejects(work, (error) => error === reason);
    assert.equal(pool.totalCount, 0);
    const replacement = await pool.query("SELECT pg_backend_pid() AS pid,value FROM records WHERE id=1");
    assert.notEqual(replacement.rows[0].pid, pid);
    assert.equal(replacement.rows[0].value, 1);
    await until(async () => (await control.query("SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid=$1", [pid])).rowCount === 0);
    await pool.query("UPDATE records SET value=1 WHERE id=1");
  });

  await t.test("caller abort during pool acquisition rejects before a held client is released", async () => {
    const pool = connection(), held = await pool.connect(), controller = new AbortController();
    const pid = (await held.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    let operations = 0;
    const queued = withPostgresTransaction(pool, async () => { operations++; }, { workload: "retrieval", signal: controller.signal });
    await until(() => pool.waitingCount === 1);
    controller.abort();
    await assert.rejects(queued, { name: "AbortError" });
    assert.equal(pool.idleCount, 0, "the caller was cancelled while the only client remained held");
    held.release();
    await until(() => pool.waitingCount === 0 && pool.idleCount === 1);
    assert.equal(operations, 0, "late acquisition must not submit cancelled SQL");
    assert.equal((await pool.query("SELECT pg_backend_pid() AS pid")).rows[0].pid, pid);
  });

  await t.test("search carries caller cancellation through the repository's workspace lock", async () => {
    const pool = connection(), tenantId = randomUUID(), blocker = await control.connect();
    await control.query(`INSERT INTO ${schema}.tenants VALUES($1)`, [tenantId]);
    const pid = (await pool.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const controller = new AbortController();
    try {
      await blocker.query("BEGIN");
      await blocker.query(`SELECT id FROM ${schema}.tenants WHERE id=$1 FOR UPDATE`, [tenantId]);
      const search = new SearchDocumentsUseCase(
        { embed: async () => assert.fail("A precomputed query vector must not call a provider.") },
        new PgDocumentRepository(pool, 1024),
        { enabled: false, rerank: async () => assert.fail("Cancelled retrieval must not reach a reranker.") },
        { defaultTopK: 5, vectorCandidateMultiplier: 4, keywordCandidateMultiplier: 3, reciprocalRankConstant: 60, rerankerCandidateMultiplier: 4, defaultTenantId: tenantId },
      );
      const work = search.execute({ query: "Fixture question", tenantId, queryEmbedding: [1, ...Array(1023).fill(0)], signal: controller.signal });
      await until(async () => (await control.query("SELECT wait_event_type='Lock' AS blocked FROM pg_catalog.pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.blocked === true);
      const reason = new Error("Search was cancelled.");
      controller.abort(reason);
      await assert.rejects(work, (error) => error === reason);
      assert.equal(pool.totalCount, 0);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    assert.equal((await pool.query("SELECT 1 AS value")).rows[0].value, 1);
  });

  await t.test("cancelled MCP admission and provider reservations stop while waiting for locks", async () => {
    for (const operation of ["admit", "reserve"] as const) {
      const pool = connection(), tenantId = randomUUID(), userId = randomUUID();
      await control.query(`INSERT INTO ${schema}.tenants VALUES($1)`, [tenantId]);
      await control.query(`INSERT INTO ${schema}.tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')`, [tenantId, userId]);
      const controls = new PgMcpControls(pool, { callsPerMinute: 10, callsPerDay: 100, providerCallsPerDay: 100, inputTokensPerDay: 10000, userCostNanoUsdPerDay: 100000, tenantCostNanoUsdPerDay: 100000, concurrentProviders: 1 });
      const blocker = await control.connect(), controller = new AbortController();
      const pid = (await pool.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      if (operation === "admit") assert.equal(await controls.admit(tenantId, userId, controller.signal), true);
      try {
        await blocker.query("BEGIN");
        if (operation === "admit") {
          await blocker.query(`SELECT 1 FROM ${schema}.workspace_mcp_call_usage WHERE tenant_id=$1 FOR UPDATE`, [tenantId]);
        } else {
          await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('mcp-provider:'||$1::text,0))", [tenantId]);
        }
        const work = operation === "admit"
          ? controls.admit(tenantId, userId, controller.signal)
          : controls.reserve({ tenantId, userId, inputTokens: 10, costNanoUsd: 1, signal: controller.signal });
        await until(async () => (await control.query("SELECT wait_event_type='Lock' AS blocked FROM pg_catalog.pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.blocked === true);
        const reason = new Error("Cancelled before provider execution.");
        controller.abort(reason);
        await assert.rejects(work, (error) => error === reason);
      } finally { await blocker.query("ROLLBACK"); blocker.release(); }
      assert.equal((await pool.query("SELECT 1 AS value")).rows[0].value, 1);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM workspace_mcp_provider_reservations WHERE tenant_id=$1", [tenantId])).rows[0].count, 0);
      const usage = (await pool.query("SELECT calls FROM workspace_mcp_call_usage WHERE tenant_id=$1", [tenantId])).rows;
      assert.deepEqual(usage, operation === "admit" ? [{ calls: 1 }] : []);
    }
  });

  await t.test("fatal idle-transaction timeout is handled between queries without crashing", async () => {
    const pool = connection();
    await assert.rejects(withPostgresTransaction(pool, async (client) => {
      await client.query("UPDATE records SET value=88 WHERE id=1");
      await pause(250);
    }, { limits: { statementMs: 1000, lockMs: 100, idleTransactionMs: 75 } }), { code: "25P03" });
    assert.equal((await pool.query("SELECT value FROM records WHERE id=1")).rows[0].value, 1);
    assert.equal(pool.idleCount, 1);
  });

  await t.test("legacy direct checkouts also handle fatal idle errors until explicit release", async (t) => {
    const pool = connection("runtime", "-c idle_in_transaction_session_timeout=75ms");
    const log = t.mock.method(console, "warn", () => {});
    const client = await pool.connect();
    const failed = new Promise<void>((resolve) => client.once("error", () => resolve()));
    try {
      await client.query("BEGIN");
      await failed;
      await assert.rejects(client.query("SELECT 1"));
    } finally { client.release(true); }
    assert.equal(log.mock.callCount(), 1);
    assert.deepEqual(JSON.parse(String(log.mock.calls[0]?.arguments[0])), { event: "database_pool_fault", reason: "checked_out_connection_error" });
    assert.equal((await pool.query("SELECT 1 AS value")).rows[0].value, 1);
  });

  await t.test("read-only transactions retain repeatable-read isolation and recover after a rejected write", async () => {
    const pool = connection();
    await withPostgresTransaction(pool, async (client) => {
      const result = await client.query("SHOW transaction_isolation");
      assert.equal(result.rows[0].transaction_isolation, "repeatable read");
    }, { workload: "retrieval", readOnly: true });
    await assert.rejects(withPostgresTransaction(pool, (client) => client.query("UPDATE records SET value=5 WHERE id=1"), { workload: "retrieval", readOnly: true }), { code: "25006" });
    await pool.query("UPDATE records SET value=1 WHERE id=1");
    assert.equal(pool.idleCount, 1);
  });

  await t.test("maintenance gets a distinct long profile and does not inherit retrieval caps", async () => {
    const maintenance = connection("maintenance");
    assert.deepEqual(await settings(maintenance), { statement_timeout: 600000, lock_timeout: 10000, idle_in_transaction_session_timeout: 60000 });
    await withPostgresTransaction(maintenance, async (client) => {
      const result = await client.query("SELECT current_setting('statement_timeout') AS statement");
      assert.equal(result.rows[0].statement, "10min");
      await client.query("SELECT pg_sleep($1)", [(postgresDeadlineProfiles.retrieval.statementMs + 100) / 1000]);
    });
    assert.deepEqual(await settings(maintenance), { statement_timeout: 600000, lock_timeout: 10000, idle_in_transaction_session_timeout: 60000 });
  });

  await t.test("awaited startup negotiation times out, destroys the unusable client and can reconnect", async () => {
    const pool = connection(), setup = pool.options.onConnect!;
    pool.options.onConnect = (client) => {
      const nativeQuery = client.query.bind(client);
      client.query = ((statement: string, values?: unknown[]) =>
        statement.includes("pg_catalog.pg_settings")
          ? nativeQuery("SELECT pg_sleep(10)")
          : nativeQuery(statement, values)) as typeof client.query;
      return setup(client);
    };
    await assert.rejects(pool.query("SELECT 1"), /deadline setup timed out/);
    assert.equal(pool.totalCount, 0);
    assert.equal(pool.idleCount, 0);
    pool.options.onConnect = setup;
    assert.equal((await pool.query("SELECT 1 AS value")).rows[0].value, 1);
  });
});
