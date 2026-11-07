import type { BudgetAlertService } from "./application/ports/budget-alert-service.js";
import type { UsageMetricsRepository } from "./application/ports/usage-metrics-repository.js";
import { ProviderMeasurements } from "./application/services/provider-measurements.js";

export function createUsageServices(dependencies: {
  usageMetrics: UsageMetricsRepository;
  budgetAlerts: BudgetAlertService;
  reportEnqueueFailure: () => void;
}) {
  const { usageMetrics: rawUsageMetrics, budgetAlerts, reportEnqueueFailure } = dependencies;
  const usageMetrics: UsageMetricsRepository = {
    summarize: rawUsageMetrics.summarize.bind(rawUsageMetrics),
    record: async (input) => {
      await rawUsageMetrics.record(input);
      await budgetAlerts.enqueue(input.tenantId).catch(reportEnqueueFailure);
    },
  };
  return { budgetAlerts, usageMetrics, measurements: new ProviderMeasurements(usageMetrics) };
}
