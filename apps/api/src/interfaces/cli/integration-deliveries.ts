import { parseArgs } from "node:util";
import { z } from "zod";
import { config } from "../../config.js";
import { BudgetAlerts } from "../../modules/usage/infrastructure/observability/budget-alerts.js";
import { createPostgresPool } from "../../platform/database/pool.js";
const pool = createPostgresPool(config.DATABASE_URL, 1, "maintenance");
try {
  const { values } = parseArgs({
    options: {
      workspace: { type: "string" },
      actor: { type: "string" },
      id: { type: "string" },
      "expected-attempts": { type: "string" },
      key: { type: "string" },
      apply: { type: "boolean" },
    },
  });
  const tenantId = z.uuid().parse(values.workspace),
    actorId = z.uuid().parse(values.actor);
  if (
    !(
      await pool.query(
        "SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 AND role='owner'",
        [tenantId, actorId],
      )
    ).rowCount
  )
    throw new Error("Owner access required.");
  const alerts = new BudgetAlerts(pool, {
    url: config.BUDGET_ALERT_WEBHOOK_URL,
    secret: config.BUDGET_ALERT_WEBHOOK_SECRET,
    thresholdUsd: config.USAGE_ALERT_THRESHOLD_USD,
  });
  const result = values.apply
    ? await alerts.replay({
        tenantId,
        actorId,
        id: z.uuid().parse(values.id),
        expectedAttempts: z.coerce
          .number()
          .int()
          .min(1)
          .max(8)
          .parse(values["expected-attempts"]),
        idempotencyKey: z.string().parse(values.key),
      })
    : await alerts.status(tenantId);
  process.stdout.write(JSON.stringify(result) + "\n");
} catch {
  process.stderr.write(
    "Delivery command failed. Verify owner, workspace, key and expected attempts; consult the recovery runbook.\n",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
