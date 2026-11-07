import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { Pool } from "pg";
import { BudgetAlerts } from "../observability/budget-alerts.js";
import { PgUsageMetricsRepository } from "./pg-usage-metrics-repository.js";

const url = process.env.MCP_TEST_DATABASE_URL;

async function fixture(t: TestContext) {
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url!).hostname),
    "Use a disposable local database.",
  );
  const schema = `budget_repair_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({
    connectionString: url,
    max: 4,
    options: `-c search_path=${schema},public`,
  });
  t.after(async () => {
    await pool.end();
    try {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  });
  for (const name of [
    "tenants",
    "ai_usage_events",
    "budget_alert_outbox",
    "integration_delivery_events",
  ]) {
    await admin.query(
      `CREATE TABLE ${schema}.${name} (LIKE public.${name} INCLUDING ALL)`,
    );
  }
  return pool;
}

test("a ledger commit without an outbox survives 25 hours offline and retries with one delivery identity", { skip: !url, timeout: 20000 }, async (t) => {
  const pool = await fixture(t);
  const tenantId = randomUUID();
  await pool.query(
    "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Budget recovery fixture')",
    [tenantId, `budget-${tenantId}`],
  );
  // Commit the real ledger write, then simulate a process stopping before the
  // separately scheduled enqueue. No provider calls or new ledger rows follow.
  await new PgUsageMetricsRepository(pool).record({
    tenantId,
    actorKey: "fixture",
    operation: "embedding_document",
    provider: "fixture",
    model: "fixture",
    cacheHit: false,
    inputTokens: 10,
    outputTokens: 0,
    latencyMs: 1,
    estimatedCostUsd: 2,
    pricingKnown: true,
    failed: false,
  });
  await pool.query(
    "UPDATE ai_usage_events SET created_at=clock_timestamp()-interval '25 hours' WHERE tenant_id=$1",
    [tenantId],
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS count FROM budget_alert_outbox")).rows[0].count,
    0,
  );
  const seen: Array<{ id: string | null; payload: string }> = [];
  let status = 429;
  const options = {
    url: "https://hooks.example.com/budget",
    secret: "fixture-signing-key-at-least-32-characters",
    thresholdUsd: 1,
    fetch: (async (_url, init) => {
      seen.push({
        id: new Headers(init?.headers).get("idempotency-key"),
        payload: String(init?.body),
      });
      return new Response(null, { status, headers: { "retry-after": "60" } });
    }) as typeof fetch,
  };
  await Promise.all([
    new BudgetAlerts(pool, options).work(),
    new BudgetAlerts(pool, options).work(),
  ]);
  const afterRestart = await new BudgetAlerts(pool, options).status(tenantId);
  assert.equal(afterRestart.recent.length, 1);
  assert.equal(afterRestart.recent[0].status, "queued");
  assert.equal(afterRestart.recent[0].attempts, 1);
  assert.equal(
    seen.length,
    1,
    "concurrent repair workers share one fenced delivery",
  );
  assert.equal(seen[0].id, afterRestart.recent[0].id);
  assert.equal(JSON.parse(seen[0].payload).recordedCostUsd, 2);
  assert.equal(JSON.parse(seen[0].payload).windowDays, 30);

  status = 204;
  await pool.query(
    "UPDATE budget_alert_outbox SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [afterRestart.recent[0].id],
  );
  await new BudgetAlerts(pool, options).work();
  await new BudgetAlerts(pool, options).work();
  const delivered = await new BudgetAlerts(pool, options).status(tenantId);
  assert.equal(delivered.recent.length, 1);
  assert.equal(delivered.recent[0].status, "delivered");
  assert.equal(delivered.recent[0].attempts, 2);
  assert.equal(seen.length, 2);
  assert.deepEqual(
    seen[1],
    seen[0],
    "a retry retains the immutable alert ID and cost snapshot",
  );
  assert.equal(
    (await pool.query(
      "SELECT count(*)::int AS count FROM integration_delivery_events WHERE delivery_id=$1 AND outcome='queued'",
      [afterRestart.recent[0].id],
    )).rows[0].count,
    1,
  );
  const ledger = (await pool.query(
    "SELECT count(*)::int AS count,bool_and(created_at<clock_timestamp()-interval '24 hours') AS old FROM ai_usage_events",
  )).rows[0];
  assert.equal(ledger.count, 1);
  assert.equal(ledger.old, true);
});

test("full-window repair paginates 100 tenants at a time and concurrent repeats deduplicate intents", { skip: !url, timeout: 30000 }, async (t) => {
  const pool = await fixture(t);
  await pool.query(`WITH workspaces AS (
    INSERT INTO tenants(id,slug,name)
    SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'budget-fixture-'||n,'Budget page fixture'
    FROM generate_series(1,108) n RETURNING id
  ) INSERT INTO ai_usage_events(tenant_id,actor_key,operation,provider,model,latency_ms,estimated_cost_usd,pricing_known,created_at)
    SELECT id,'fixture','answer','fixture','fixture',1,
      CASE WHEN id::text LIKE '%000000000108' THEN 0.25 ELSE 2 END,true,
      clock_timestamp()-CASE
        WHEN id::text LIKE '%000000000106' THEN interval '30 days 1 hour'
        WHEN id::text LIKE '%000000000107' THEN interval '-1 hour'
        ELSE interval '25 hours' END
    FROM workspaces`);
  const options = {
    url: "https://hooks.example.com/budget",
    secret: "fixture-signing-key-at-least-32-characters",
    thresholdUsd: 1,
    fetch: (async () => new Response(null, { status: 429, headers: { "retry-after": "60" } })) as typeof fetch,
  };
  const first = new BudgetAlerts(pool, options),
    second = new BudgetAlerts(pool, options);
  await Promise.all([first.work(), second.work()]);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS count FROM budget_alert_outbox")).rows[0].count,
    100,
    "one repair pass is bounded to 100 eligible tenants",
  );
  const initial = (await pool.query<{ id: string; tenant_id: string }>(
    "SELECT id,tenant_id FROM budget_alert_outbox",
  )).rows;
  await Promise.all([first.work(), second.work()]);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS count FROM budget_alert_outbox")).rows[0].count,
    105,
  );
  await first.work();
  const repaired = (await pool.query<{ id: string; tenant_id: string }>(
    "SELECT id,tenant_id FROM budget_alert_outbox",
  )).rows;
  assert.equal(
    repaired.length,
    105,
    "expired, future-only and below-threshold usage creates no alert",
  );
  for (const previous of initial) {
    assert.ok(repaired.some(
      (row) => row.tenant_id === previous.tenant_id && row.id === previous.id,
    ));
  }
  assert.equal(
    (await pool.query(
      "SELECT count(*)::int AS count FROM integration_delivery_events WHERE outcome='queued'",
    )).rows[0].count,
    105,
    "repeated/concurrent discovery appends one intent event per stable alert",
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS count FROM budget_alert_outbox WHERE cost_usd<>2")).rows[0].count,
    0,
  );
});
