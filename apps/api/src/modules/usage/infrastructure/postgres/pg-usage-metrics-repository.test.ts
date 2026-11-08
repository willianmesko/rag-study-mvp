import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { PgUsageMetricsRepository } from "./pg-usage-metrics-repository.js";
import { StoredRecordError } from "../../../../platform/database/stored-record.js";

const tenantId = "a7f8f2cb-016d-44c6-acba-14c31823caa0";
const start = new Date("2026-10-09T00:00:00Z"), end = new Date("2026-11-08T00:00:00Z");
const emptyRow = () => ({ bucket: "total", requests: "0", cache_hits: "0", input_tokens: "0", output_tokens: "0",
  estimated_cost_usd: "0.000000", average_latency_ms: "0", provider_failures: "0", observed_requests: "0",
  observed_cost_usd: "0", effective_cost_usd: "0", estimated_only_cost_usd: "0", observed_cost_requests: "0",
  estimated_cost_requests: "0", skipped_requests: "0", observed_input_tokens: "0", observed_output_tokens: "0",
  estimated_input_tokens: "0", estimated_output_tokens: "0", p95_latency_ms: "0", unpriced_requests: "0",
  extended_since: null, window_start: start, window_end: end });
function fixture(rows: unknown[]) {
  const queries: unknown[][] = [];
  const pool = { async query(sql: string, values: unknown[]) { queries.push([sql, values]); return { rows }; } } as unknown as Pool;
  return { repository: new PgUsageMetricsRepository(pool), queries };
}
test("usage aggregates decode driver numerics, preserve native zero and sort checked dimensions", async () => {
  const total = { ...emptyRow(), requests: "2", input_tokens: 10, average_latency_ms: "1.5e2",
    p95_latency_ms: "250.25", effective_cost_usd: "0.0002", observed_cost_requests: "1", extended_since: start };
  const { repository, queries } = fixture([total,
    { ...total, bucket: "model", provider: "fixture", model: "second", effective_cost_usd: "0.0001" },
    { ...total, bucket: "model", provider: "fixture", model: "first" },
    { ...total, bucket: "operation", operation: "question_answering" },
    { ...total, bucket: "day", day: "2026-11-08" }]);
  const result = await repository.summarize({ tenantId, days: 30 });
  assert.equal(result.requests, 2); assert.equal(result.inputTokens, 10); assert.equal(result.averageLatencyMs, 150);
  assert.equal(result.p95LatencyMs, 250.25); assert.equal(result.observedCostUsd, 0); assert.equal(result.observedCostRequests, 1);
  assert.equal(result.effectiveCostUsd, 0.0002); assert.equal(result.extendedSince, start.toISOString());
  assert.deepEqual(result.models?.map(({ model }) => model), ["first", "second"]);
  assert.equal(result.operations?.[0]?.operation, "question_answering"); assert.equal(result.daily?.[0]?.date, "2026-11-08");
  assert.equal(queries.length, 1); assert.deepEqual(queries[0]?.[1], [tenantId, 30]);
});
test("an empty SQL window keeps deliberate COALESCE zeros and unknown extended coverage", async () => {
  const result = await fixture([emptyRow()]).repository.summarize({ tenantId, days: 30 });
  assert.equal(result.requests, 0); assert.equal(result.effectiveCostUsd, 0);
  assert.equal(result.observedCostRequests, 0); assert.equal(result.extendedSince, undefined);
  assert.deepEqual(result.models, []); assert.deepEqual(result.operations, []); assert.deepEqual(result.daily, []);
  assert.equal(result.windowStart, start.toISOString()); assert.equal(result.windowEnd, end.toISOString());
  for (const rows of [[], [emptyRow(), emptyRow()]])
    await assert.rejects(fixture(rows).repository.summarize({ tenantId, days: 30 }), StoredRecordError);
});
test("invalid usage projections fail safely rather than inventing zero, dimensions or dates", async () => {
  const patches = [{ requests: null }, { requests: "" }, { requests: false }, { requests: "1.5" },
    { requests: "9007199254740992" }, { requests: undefined }, { estimated_cost_usd: " " },
    { estimated_cost_usd: "Infinity" }, { average_latency_ms: NaN }, { p95_latency_ms: -1 },
    { window_start: new Date("invalid") }, { window_end: end.toISOString() }, { extended_since: "PRIVATE_SENTINEL" },
    { bucket: "unknown" }, { bucket: "model", provider: null, model: "PRIVATE_SENTINEL" },
    { bucket: "model", provider: "fixture", model: 1 }, { bucket: "operation", operation: null },
    { bucket: "day", day: "2026-02-30" }];
  for (const patch of patches)
    await assert.rejects(fixture([{ ...emptyRow(), ...patch }]).repository.summarize({ tenantId, days: 30 }),
      (error: unknown) => error instanceof StoredRecordError && error.code === "invalid_stored_record" &&
        !String(error).includes("PRIVATE_SENTINEL") && !("cause" in error));
});
test("invalid usage windows are rejected before querying the ledger", async () => {
  const { repository, queries } = fixture([]);
  for (const days of [0, -1, 91, 1.5, NaN, Infinity])
    await assert.rejects(repository.summarize({ tenantId, days }), /between 1 and 90/);
  assert.deepEqual(queries, []);
});
