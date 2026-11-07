import { parseArgs } from "node:util";
import { Pool } from "pg";
import { config } from "../../config.js";
import { workflowCodecFromEnvironment } from "../../infrastructure/security/workflow-state-codec.js";
import { rotateWorkflowKeys } from "../../infrastructure/postgres/rotate-workflow-keys.js";
const pool = new Pool({ connectionString: config.DATABASE_URL, max: 1 });
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
