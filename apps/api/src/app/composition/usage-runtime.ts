import { createUsageServices } from "../../modules/usage/usage.module.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { CoreRuntime } from './core-runtime.js';
import { createPostgresUsageBindings } from "./postgres-persistence.js";
export function createUsageRuntime(config: RuntimeConfiguration, core: CoreRuntime) {
    const { pool } = core;
    const usageBindings = createPostgresUsageBindings(pool, {
        url: config.BUDGET_ALERT_WEBHOOK_URL,
        secret: config.BUDGET_ALERT_WEBHOOK_SECRET,
        thresholdUsd: config.USAGE_ALERT_THRESHOLD_USD,
        log: (record) => process.stdout.write(JSON.stringify(record) + "\n"),
    });
    const { budgetAlerts, usageMetrics, measurements } = createUsageServices({
        ...usageBindings,
        reportEnqueueFailure: () => process.stdout.write('{"event":"budget_alert_enqueue","reason":"database_unavailable"}\n'),
    });
    return { usageBindings, budgetAlerts, usageMetrics, measurements };
}
export type UsageRuntime = ReturnType<typeof createUsageRuntime>;
