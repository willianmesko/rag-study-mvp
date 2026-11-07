import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { usageSummarySchema } from "@rag-study/contracts";
import { PgUsageMetricsRepository } from "./pg-usage-metrics-repository.js";
const url = process.env.MCP_TEST_DATABASE_URL;
test(
  "usage analytics reconcile cost provenance, model identity, dates and workspace boundaries",
  { skip: !url, timeout: 30000 },
  async (t) => {
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url!).hostname),
      "Use a disposable local database.",
    );
    const pool = new Pool({ connectionString: url, max: 3 }),
      tenantId = randomUUID(),
      other = randomUUID(),
      empty = randomUUID();
    const repo = new PgUsageMetricsRepository(pool);
    t.after(async () => {
      try {
        await pool.query("DELETE FROM tenants WHERE id=ANY($1::uuid[])", [
          [tenantId, other, empty],
        ]);
      } finally {
        await pool.end();
      }
    });
    for (const id of [tenantId, other, empty])
      await pool.query(
        "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Usage fixture')",
        [id, `usage-${id}`],
      );
    const record = async (
      model: string,
      options: Partial<Parameters<typeof repo.record>[0]> = {},
    ) =>
      repo.record({
        tenantId,
        actorKey: "private-fixture-actor",
        operation: "question_answering",
        provider: "openrouter",
        model,
        cacheHit: false,
        inputTokens: 100,
        outputTokens: 20,
        latencyMs: 100,
        estimatedCostUsd: 0.0012,
        failed: false,
        ...options,
      });
    await record("small");
    await record("small", {
      inputTokens: 200,
      outputTokens: 40,
      source: "observed",
      observedCostUsd: 0.0018,
      estimatedCostUsd: 0.002,
      latencyMs: 300,
    });
    await record("small", {
      cacheHit: true,
      source: "cache",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 50,
    });
    await record("small", {
      source: "none",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 20,
    });
    await record("large", {
      operation: "question_comparison",
      source: "observed",
      inputTokens: 300,
      outputTokens: 60,
      estimatedCostUsd: 0.004,
      latencyMs: 500,
    });
    await record("large", {
      operation: "question_auto_routing",
      inputTokens: 50,
      outputTokens: 0,
      estimatedCostUsd: 0.0005,
      failed: true,
      latencyMs: 150,
    });
    await record("large", { provider: "bedrock", estimatedCostUsd: 0.0004 });
    await record("free", {
      source: "observed",
      observedCostUsd: 0,
      estimatedCostUsd: 0.003,
    });
    await record("secret-other-model", {
      tenantId: other,
      estimatedCostUsd: 99,
    });
    for (const [offset, cost] of [
      [28, 0.002],
      [95, 55],
      [-1, 77],
    ])
      await pool.query(
        "INSERT INTO ai_usage_events(tenant_id,actor_key,operation,provider,model,latency_ms,estimated_cost_usd,created_at) VALUES($1,'private-fixture-actor','question_answering','openrouter','historical',100,$2,NOW()-$3*interval '1 day')",
        [tenantId, cost, offset],
      );
    const summary = usageSummarySchema.parse(
      await repo.summarize({ tenantId, days: 30 }),
    );
    assert.equal(summary.requests, 9);
    assert.equal(summary.cacheHits, 1);
    assert.equal(summary.providerFailures, 1);
    assert.equal(summary.observedRequests, 3);
    assert.equal(summary.observedCostRequests, 2);
    assert.equal(summary.estimatedCostRequests, 5);
    assert.ok(Math.abs(summary.effectiveCostUsd! - 0.0099) < 1e-8);
    assert.ok(Math.abs(summary.observedCostUsd - 0.0018) < 1e-8);
    assert.ok(Math.abs(summary.estimatedOnlyCostUsd! - 0.0081) < 1e-8);
    assert.equal(summary.models.length, 5);
    for (const partition of [
      summary.models,
      summary.operations,
      summary.daily,
    ]) {
      assert.equal(
        partition.reduce((n, row) => n + row.requests, 0),
        summary.requests,
      );
      assert.equal(
        partition.reduce((n, row) => n + row.inputTokens, 0),
        summary.inputTokens,
      );
      assert.ok(
        Math.abs(
          partition.reduce((n, row) => n + row.effectiveCostUsd!, 0) -
            summary.effectiveCostUsd!,
        ) < 1e-8,
      );
    }
    const large = summary.models.find(
      (row) => row.provider === "openrouter" && row.model === "large",
    )!;
    assert.equal(large.requests, 2);
    assert.equal(large.averageLatencyMs, 325);
    assert.equal(large.p95LatencyMs, 482.5);
    assert.equal(
      summary.models.find((row) => row.model === "free")?.effectiveCostUsd,
      0,
    );
    assert.doesNotMatch(
      JSON.stringify(summary),
      /private-fixture-actor|secret-other-model/,
    );
    assert.equal((await repo.summarize({ tenantId, days: 7 })).requests, 8);
    const noUsage = usageSummarySchema.parse(
      await repo.summarize({ tenantId: empty, days: 30 }),
    );
    assert.equal(noUsage.requests, 0);
    assert.equal(noUsage.effectiveCostUsd, 0);
    assert.equal(noUsage.p95LatencyMs, 0);
    assert.deepEqual(noUsage.models, []);
    for (const days of [0, 91, 1.5])
      await assert.rejects(
        repo.summarize({ tenantId, days }),
        /between 1 and 90/,
      );
  },
);
