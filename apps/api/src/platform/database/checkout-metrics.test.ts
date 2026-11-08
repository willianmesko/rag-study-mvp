import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import type { Pool, PoolClient } from "pg";
import { metrics } from "@opentelemetry/api";
import { AggregationTemporality, DataPointType, MeterProvider, MetricReader } from "@opentelemetry/sdk-metrics";
import { acquirePostgresClient } from "./sql-boundary.js";

class PullReader extends MetricReader {
  protected async onShutdown() {}
  protected async onForceFlush() {}
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const poolFor = (connect: () => Promise<PoolClient>) => ({ connect }) as unknown as Pool;

test("guarded checkout metrics preserve operation outcomes and resource ownership", async (t) => {
  const reader = new PullReader({ aggregationTemporalitySelector: () => AggregationTemporality.DELTA });
  const provider = new MeterProvider({ readers: [reader] });
  assert.ok(metrics.setGlobalMeterProvider(provider));
  t.after(async () => { await provider.shutdown(); metrics.disable(); });
  const collect = async () => {
    const result = await reader.collect(); assert.deepEqual(result.errors, []);
    const instrument = result.resourceMetrics.scopeMetrics.flatMap(({ metrics: records }) => records)
      .find(({ descriptor }) => descriptor.name === "lumora.database.checkout.duration");
    if (!instrument) return [];
    assert.equal(instrument.descriptor.unit, "s"); assert.equal(instrument.dataPointType, DataPointType.HISTOGRAM);
    if (instrument.dataPointType !== DataPointType.HISTOGRAM) assert.fail();
    const points = instrument.dataPoints.filter(({ value }) => value.count > 0);
    for (const point of points) {
      assert.deepEqual(Object.keys(point.attributes), ["outcome"]);
      assert.ok(Number.isFinite(point.value.sum) && point.value.sum! >= 0);
      assert.doesNotMatch(JSON.stringify(point), /PRIVATE_|postgresql:\/\//);
    }
    return points;
  };
  await t.test("diagnostic failure cannot fail an acquired client", async (c) => {
    c.mock.method(metrics, "getMeter", () => { throw new Error("PRIVATE_METRIC_ERROR"); });
    const client = {} as PoolClient;
    assert.equal(await acquirePostgresClient(poolFor(async () => client), new AbortController().signal), client);
    assert.deepEqual(await collect(), []);
  });
  await t.test("successful acquisition records once, before SQL work, and keeps client identity", async () => {
    const signal = new AbortController().signal, client = {} as PoolClient;
    assert.equal(await acquirePostgresClient(poolFor(async () => client), signal), client);
    const points = await collect(); assert.equal(points.length, 1); assert.equal(points[0]?.attributes.outcome, "acquired");
    assert.equal(points[0]?.value.count, 1); assert.equal(getEventListeners(signal, "abort").length, 0);
    assert.deepEqual(await collect(), []);
  });
  await t.test("cancellation records once and releases a late client without recording success", async () => {
    const pending = deferred<PoolClient>(), controller = new AbortController(), reason = new Error("PRIVATE_CANCEL");
    let releases = 0;
    const result = acquirePostgresClient(poolFor(() => pending.promise), controller.signal);
    controller.abort(reason); await assert.rejects(result, (error) => error === reason);
    pending.resolve({ release: () => { releases++; } } as unknown as PoolClient); await Promise.resolve();
    const points = await collect(); assert.equal(releases, 1); assert.equal(points.length, 1);
    assert.equal(points[0]?.attributes.outcome, "cancelled"); assert.equal(points[0]?.value.count, 1);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
  await t.test("rejections and synchronous failures preserve error identity and remove listeners", async () => {
    for (const synchronous of [false, true]) {
      const reason = new Error("PRIVATE_DRIVER_FAILURE"), controller = new AbortController();
      const pool = poolFor(() => { if (synchronous) throw reason; return Promise.reject(reason); });
      await assert.rejects(acquirePostgresClient(pool, controller.signal), (error) => error === reason);
      const points = await collect(); assert.equal(points[0]?.attributes.outcome, "failed"); assert.equal(points[0]?.value.count, 1);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    }
  });
  await t.test("an already-cancelled signal never attempts checkout or fabricates a sample", async () => {
    const controller = new AbortController(); controller.abort(); let calls = 0;
    assert.throws(() => acquirePostgresClient(poolFor(() => { calls++; throw new Error("Unexpected checkout"); }), controller.signal));
    assert.equal(calls, 0); assert.deepEqual(await collect(), []);
  });
  await t.test("concurrent checkouts retain independent acquired and cancelled samples", async () => {
    const first = deferred<PoolClient>(), second = deferred<PoolClient>(), controller = new AbortController();
    const acquired = acquirePostgresClient(poolFor(() => first.promise), new AbortController().signal);
    const cancelled = acquirePostgresClient(poolFor(() => second.promise), controller.signal);
    controller.abort(); await assert.rejects(cancelled); first.resolve({} as PoolClient); await acquired;
    let releases = 0; second.resolve({ release: () => { releases++; } } as unknown as PoolClient); await Promise.resolve();
    const points = await collect(); assert.equal(releases, 1);
    assert.deepEqual(points.map(({ attributes, value }) => [attributes.outcome, value.count]).sort(), [["acquired", 1], ["cancelled", 1]]);
  });
});
