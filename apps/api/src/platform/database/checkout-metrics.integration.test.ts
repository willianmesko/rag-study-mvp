import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";
import { metrics } from "@opentelemetry/api";
import { AggregationTemporality, DataPointType, MeterProvider, MetricReader } from "@opentelemetry/sdk-metrics";
import { createPostgresPool } from "./pool.js";
import { acquirePostgresClient } from "./sql-boundary.js";

class PullReader extends MetricReader {
  protected async onShutdown() {}
  protected async onForceFlush() {}
}
const url = process.env.MCP_TEST_DATABASE_URL;
test("real guarded checkout measures pool contention and cancellation without counting direct queries or late success", { skip: !url, timeout: 15000 }, async (t) => {
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url!).hostname), "Use a disposable loopback database.");
  const reader = new PullReader({ aggregationTemporalitySelector: () => AggregationTemporality.DELTA });
  const provider = new MeterProvider({ readers: [reader] });
  assert.ok(metrics.setGlobalMeterProvider(provider));
  const pool = createPostgresPool(url!, 1);
  t.after(async () => { try { await pool.end(); } finally { await provider.shutdown(); metrics.disable(); } });
  const collect = async () => {
    const result = await reader.collect(); assert.deepEqual(result.errors, []);
    const record = result.resourceMetrics.scopeMetrics.flatMap(({ metrics: records }) => records)
      .find(({ descriptor }) => descriptor.name === "lumora.database.checkout.duration");
    if (!record) return [];
    assert.equal(record.dataPointType, DataPointType.HISTOGRAM);
    if (record.dataPointType !== DataPointType.HISTOGRAM) assert.fail();
    const points = record.dataPoints.filter(({ value }) => value.count > 0);
    assert.doesNotMatch(JSON.stringify(points), /PRIVATE_|postgresql:\/\//);
    return points;
  };
  await pool.query("SELECT 1"); assert.deepEqual(await collect(), [], "Direct pool queries are outside the measured helper.");
  const held = await pool.connect();
  const waiting = acquirePostgresClient(pool, new AbortController().signal);
  try { assert.equal(pool.waitingCount, 1); await delay(70); }
  finally {
    held.release();
    const client = await waiting;
    try { assert.equal((await client.query("SELECT 1 AS alive")).rows[0].alive, 1); }
    finally { client.release(); }
  }
  const acquired = await collect(); assert.equal(acquired.length, 1);
  assert.equal(acquired[0]?.attributes.outcome, "acquired"); assert.equal(acquired[0]?.value.count, 1);
  assert.ok(acquired[0]!.value.min! >= 0.05, "The guarded checkout includes the controlled queued interval.");

  const heldAgain = await pool.connect(), controller = new AbortController(), reason = new Error("PRIVATE_CANCEL");
  const cancelled = acquirePostgresClient(pool, controller.signal); void cancelled.catch(() => {});
  try {
    assert.equal(pool.waitingCount, 1); controller.abort(reason);
    await assert.rejects(cancelled, (error) => error === reason);
  } finally {
    controller.abort(); heldAgain.release();
    const unexpected = await cancelled.catch(() => null); unexpected?.release(); await nextTurn();
  }
  const aborted = await collect(); assert.equal(aborted.length, 1);
  assert.equal(aborted[0]?.attributes.outcome, "cancelled"); assert.equal(aborted[0]?.value.count, 1);
  assert.equal(pool.idleCount, 1); assert.equal(pool.waitingCount, 0);
  assert.equal((await pool.query("SELECT 1 AS reusable")).rows[0].reusable, 1);
  assert.deepEqual(await collect(), [], "Neither late client release nor direct SQL adds a successful checkout sample.");
});
