import type { Pool } from "pg";
import { BudgetAlerts } from "./infrastructure/observability/budget-alerts.js";
import { ProviderMeasurements } from "./infrastructure/observability/measured-providers.js";
import { PgUsageMetricsRepository } from "./infrastructure/postgres/pg-usage-metrics-repository.js";

export function createUsageServices(
  pool: Pool,
  options: ConstructorParameters<typeof BudgetAlerts>[1],
  reportEnqueueFailure: () => void,
) {
  const rawUsageMetrics = new PgUsageMetricsRepository(pool);
  const budgetAlerts = new BudgetAlerts(pool, options);
  const usageMetrics = {
    summarize: rawUsageMetrics.summarize.bind(rawUsageMetrics),
    record: async (input: Parameters<typeof rawUsageMetrics.record>[0]) => {
      await rawUsageMetrics.record(input);
      await budgetAlerts.enqueue(input.tenantId).catch(reportEnqueueFailure);
    },
  };
  return { budgetAlerts, usageMetrics, measurements: new ProviderMeasurements(usageMetrics) };
}
