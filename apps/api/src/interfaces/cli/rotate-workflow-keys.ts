import { parseArgs } from "node:util";
import { config } from "../../config.js";
import { workflowCodecFromEnvironment } from "../../platform/workflows/workflow-state-codec.js";
import { rotateWorkflowKeys } from "../../platform/workflows/rotate-workflow-keys.js";
import { createPostgresPool } from "../../platform/database/pool.js";
const pool = createPostgresPool(config.DATABASE_URL, 1, "maintenance");
try {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "batch-size": { type: "string" },
      "max-batches": { type: "string" },
    },
  });
  if (values.apply && values["dry-run"])
    throw new Error("Choose a single mode.");
  const result = await rotateWorkflowKeys(
    pool,
    workflowCodecFromEnvironment(config),
    {
      apply: values.apply ?? false,
      batchSize: values["batch-size"]
        ? Number(values["batch-size"])
        : undefined,
      maxBatches: values["max-batches"]
        ? Number(values["max-batches"])
        : undefined,
    },
  );
  process.stdout.write(JSON.stringify(result) + "\n");
  if (!result.complete) process.exitCode = 2;
} catch {
  process.stderr.write(
    "Key rotation failed. Keep previous keys and consult the rotation runbook.\n",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
