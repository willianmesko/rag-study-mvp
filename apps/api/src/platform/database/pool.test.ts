import assert from "node:assert/strict";
import test from "node:test";
import { metrics } from "@opentelemetry/api";
import { AggregationTemporality, MeterProvider, InMemoryMetricExporter, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { createPostgresPool } from "./pool.js";

test("idle pool faults stay handled and emit fixed content-free diagnostics", async (t) => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);
  const log = t.mock.method(console, "warn", () => {});
  const pool = createPostgresPool("postgresql://PRIVATE_CREDENTIAL@127.0.0.1:1/no-connect");
  try {
    assert.equal(pool.emit("error", new Error("PRIVATE_SENTINEL")), true);
    assert.equal(log.mock.callCount(), 1);
    assert.deepEqual(JSON.parse(String(log.mock.calls[0]?.arguments[0])), { event: "database_pool_fault", reason: "idle_connection_error" });
    await provider.forceFlush();
    const metric = exporter.getMetrics().flatMap((m) => m.scopeMetrics).flatMap((m) => m.metrics)
      .find((m) => m.descriptor.name === "lumora.database.pool.errors");
    assert.equal(metric?.dataPoints[0]?.value, 1);
    assert.ok(!JSON.stringify(exporter.getMetrics()).includes("PRIVATE_"));
  } finally { await pool.end(); await provider.shutdown(); metrics.disable(); }
});
