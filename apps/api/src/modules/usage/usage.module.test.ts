import assert from "node:assert/strict";
import test from "node:test";
import { createUsageServices } from "./usage.module.js";
import { DeliveryCommandError, type BudgetAlertService } from "./application/ports/budget-alert-service.js";
import type { UsageMetricsRepository } from "./application/ports/usage-metrics-repository.js";
import { DeliveryCommandError as AdapterDeliveryCommandError } from "./infrastructure/observability/budget-alerts.js";
import { ProviderMeasurements as CompatibleMeasurements } from "./infrastructure/observability/measured-providers.js";
import { ProviderMeasurements } from "./application/services/provider-measurements.js";

const entry: Parameters<UsageMetricsRepository["record"]>[0] = {
  tenantId: "20000000-0000-4000-8000-000000000001", actorKey: "user:fixture", operation: "embedding_query",
  provider: "fixture", model: "fixture-embedding", cacheHit: false, inputTokens: 3, outputTokens: 0,
  latencyMs: 1, estimatedCostUsd: 0, pricingKnown: false, failed: false,
};

function alertPort(enqueue: BudgetAlertService["enqueue"]): BudgetAlertService {
  return {
    configured: true, enqueue,
    status: async () => ({ configured: true, channel: "webhook", windowDays: 30, deduplication: "daily", deliveries: [], recent: [] }),
    replay: async ({ id }) => ({ id, replayed: true }), work: async () => {},
  };
}

test("usage assembly works with non-database ports and preserves commit-before-notification and repair behavior", async () => {
  const events: string[] = [];
  let ledgerUnavailable = false;
  const ledger: UsageMetricsRepository = {
    record: async (input) => {
      assert.equal(input, entry);
      events.push("ledger");
      if (ledgerUnavailable) throw new Error("Fixture ledger unavailable");
    },
    summarize: async () => { throw new Error("Unused fixture summary"); },
  };
  const alerts = alertPort(async (tenantId) => {
    assert.equal(tenantId, entry.tenantId);
    events.push("enqueue");
    throw new Error("Fixture outbox unavailable");
  });
  const service = createUsageServices({ usageMetrics: ledger, budgetAlerts: alerts, reportEnqueueFailure: () => { events.push("repair-needed"); } });
  assert.equal(service.budgetAlerts, alerts);
  await service.usageMetrics.record(entry);
  assert.deepEqual(events, ["ledger", "enqueue", "repair-needed"]);
  events.length = 0;
  ledgerUnavailable = true;
  await assert.rejects(service.usageMetrics.record(entry), /Fixture ledger unavailable/);
  assert.deepEqual(events, ["ledger"], "No notification is queued for an uncommitted usage record.");
});

test("application ports retain delivery error and measurement constructor identity across existing adapter imports", () => {
  assert.equal(AdapterDeliveryCommandError, DeliveryCommandError);
  assert.ok(new AdapterDeliveryCommandError("forbidden") instanceof DeliveryCommandError);
  assert.equal(CompatibleMeasurements, ProviderMeasurements);
});
