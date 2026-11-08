import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

export const checkoutBoundsSeconds = [0, .001, .005, .01, .025, .05, .1, .25, .5, 1, 2, 5, 10];
const outcomes = ["acquired", "cancelled", "failed"];
const metricName = "lumora.database.checkout.duration";

export function validateGuardedCheckoutReceipt(value) {
  assert.deepEqual(Object.keys(value).sort(), ["boundsMs", "coverage", "outcomes", "temporality"]);
  assert.equal(value.coverage, "guarded-client-acquisition"); assert.equal(value.temporality, "delta");
  assert.deepEqual(value.boundsMs, checkoutBoundsSeconds.map((n) => n * 1000));
  assert.deepEqual(value.outcomes.map(({ outcome }) => outcome), outcomes);
  for (const row of value.outcomes) {
    assert.deepEqual(Object.keys(row).sort(), ["buckets", "count", "maxMs", "minMs", "outcome", "sumMs"]);
    assert.ok(Number.isSafeInteger(row.count) && row.count >= 0);
    assert.ok(row.buckets.length === checkoutBoundsSeconds.length + 1 && row.buckets.every((n) => Number.isSafeInteger(n) && n >= 0));
    assert.equal(row.buckets.reduce((sum, n) => sum + n, 0), row.count);
    assert.ok([row.sumMs, row.minMs, row.maxMs].every((n) => row.count ? Number.isFinite(n) && n >= 0 : n === null));
    if (row.count) assert.ok(row.minMs <= row.maxMs);
  }
  return value;
}

export function guardedCheckoutReceipt(points) {
  assert.ok(Array.isArray(points) && points.length <= 3, "Invalid guarded checkout points.");
  const rows = new Map();
  for (const { attributes, value } of points) {
    assert.deepEqual(Object.keys(attributes), ["outcome"]);
    const outcome = attributes.outcome;
    assert.ok(outcomes.includes(outcome) && !rows.has(outcome), "Invalid checkout outcome.");
    assert.ok(Number.isSafeInteger(value.count) && value.count >= 0, "Invalid checkout count.");
    assert.deepEqual(value.buckets.boundaries, checkoutBoundsSeconds);
    const buckets = value.buckets.counts;
    assert.ok(buckets.length === checkoutBoundsSeconds.length + 1 && buckets.every((n) => Number.isSafeInteger(n) && n >= 0));
    assert.equal(buckets.reduce((sum, n) => sum + n, 0), value.count);
    if (value.count) {
      assert.ok([value.sum, value.min, value.max].every((n) => Number.isFinite(n) && n >= 0));
      assert.ok(value.min <= value.max);
    }
    rows.set(outcome, { outcome, count: value.count, sumMs: value.count ? value.sum * 1000 : null,
      minMs: value.count ? value.min * 1000 : null, maxMs: value.count ? value.max * 1000 : null, buckets: [...buckets] });
  }
  return validateGuardedCheckoutReceipt({ coverage: "guarded-client-acquisition", temporality: "delta", boundsMs: checkoutBoundsSeconds.map((n) => n * 1000),
    outcomes: outcomes.map((outcome) => rows.get(outcome) ?? { outcome, count: 0, sumMs: null, minMs: null, maxMs: null,
      buckets: Array(checkoutBoundsSeconds.length + 1).fill(0) }) });
}

// Pull-only collection from the already installed application SDK; no exporter.
export function createCheckoutProbe() {
  const require = createRequire(resolve(process.cwd(), "package.json"));
  const { metrics } = require("@opentelemetry/api");
  const { MetricReader, MeterProvider, AggregationType, AggregationTemporality, DataPointType,
    createAllowListAttributesProcessor } = require("@opentelemetry/sdk-metrics");
  class PullReader extends MetricReader {
    async onShutdown() {}
    async onForceFlush() {}
  }
  const reader = new PullReader({ aggregationTemporalitySelector: () => AggregationTemporality.DELTA,
    aggregationSelector: () => ({ type: AggregationType.DROP }) });
  const provider = new MeterProvider({ readers: [reader], views: [{ meterName: "lumora.database", instrumentName: metricName,
    attributesProcessors: [createAllowListAttributesProcessor(["outcome"])], aggregationCardinalityLimit: 4,
    aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: checkoutBoundsSeconds } } }] });
  assert.ok(metrics.setGlobalMeterProvider(provider), "A fixture meter provider already exists.");
  return {
    async collect() {
      const result = await reader.collect({ timeoutMillis: 1000 });
      assert.equal(result.errors.length, 0, "Checkout collection failed.");
      const selected = result.resourceMetrics.scopeMetrics.filter(({ scope }) => scope.name === "lumora.database")
        .flatMap(({ metrics: instruments }) => instruments).filter(({ descriptor }) => descriptor.name === metricName);
      assert.ok(selected.length <= 1, "Ambiguous checkout instrument.");
      if (!selected.length) return guardedCheckoutReceipt([]);
      assert.equal(selected[0].dataPointType, DataPointType.HISTOGRAM); assert.equal(selected[0].descriptor.unit, "s");
      return guardedCheckoutReceipt(selected[0].dataPoints);
    },
    async shutdown() { await provider.shutdown(); metrics.disable(); },
  };
}
