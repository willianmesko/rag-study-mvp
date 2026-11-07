import type { Pool } from "pg";
import type { WorkflowStateCodec } from "../security/workflow-state-codec.js";
const tables = [
  {
    table: "workflow_runs",
    column: "input_cipher",
    identity: ["tenant_id", "actor_id", "run_id"],
    suffix: ["input"],
  },
  {
    table: "workflow_checkpoints",
    column: "cipher",
    identity: [
      "tenant_id",
      "actor_id",
      "run_id",
      "graph_name",
      "namespace",
      "checkpoint_id",
    ],
    suffix: [],
  },
  {
    table: "workflow_writes",
    column: "cipher",
    identity: [
      "tenant_id",
      "actor_id",
      "run_id",
      "graph_name",
      "namespace",
      "checkpoint_id",
      "task_id",
      "ordinal",
    ],
    suffix: [],
  },
  {
    table: "workflow_effects",
    column: "cipher",
    identity: ["tenant_id", "actor_id", "run_id"],
    suffix: ["effect"],
    last: "effect_key",
  },
] as const;
/** Bounded, resumable batches. Only allowlisted identifiers are interpolated. */
export async function rotateWorkflowKeys(
  pool: Pool,
  codec: WorkflowStateCodec,
  options: { apply: boolean; batchSize?: number; maxBatches?: number },
) {
  const batch = options.batchSize ?? 50,
    max = options.maxBatches ?? 20;
  if (
    !Number.isInteger(batch) ||
    batch < 1 ||
    batch > 200 ||
    !Number.isInteger(max) ||
    max < 1 ||
    max > 1000 ||
    codec.activeKeyId === "legacy"
  )
    throw new Error(
      "Rotation requires an active versioned key and bounded batches.",
    );
  const report = {
    activeKeyId: codec.activeKeyId,
    applied: options.apply,
    examined: 0,
    changed: 0,
    remaining: 0,
    complete: true,
    byKey: {} as Record<string, number>,
  };
  for (const spec of tables) {
    // These immutable primary-key columns also define PostgreSQL's tuple ordering.
    // Heartbeats, status updates and heap rewrites must not change traversal position.
    const keys: readonly string[] = [
      ...spec.identity,
      ...("last" in spec ? [spec.last] : []),
    ];
    let after: unknown[] | undefined;
    for (let n = 0; n < max; n++) {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        await db.query("SET LOCAL statement_timeout='5s'");
        await db.query("SET LOCAL lock_timeout='500ms'");
        const prefix = codec.activeEnvelopePrefix;
        const values: unknown[] = after ? [...after] : [];
        const conditions = [`${spec.column} IS NOT NULL`];
        if (after) {
          conditions.push(
            `(${keys.join(",")}) > (${keys.map((_, index) => `$${index + 1}`).join(",")})`,
          );
        }
        if (options.apply) {
          values.push(prefix.length, prefix);
          conditions.push(
            `substring(${spec.column} from 1 for $${values.length - 1})<>$${values.length}`,
          );
        }
        values.push(batch);
        const { rows } = await db.query(
          `SELECT ${keys.join(",")},${spec.column} AS cipher FROM ${spec.table} WHERE ${conditions.join(" AND ")} ORDER BY ${keys.join(",")} LIMIT $${values.length} FOR UPDATE`,
          values,
        );
        for (const row of rows) {
          after = keys.map((field) => row[field]);
          report.examined++;
          const id = codec.keyId(row.cipher);
          report.byKey[id] = (report.byKey[id] ?? 0) + 1;
          const identity = [
            ...spec.identity.map((field) => String(row[field])),
            ...spec.suffix,
            ...("last" in spec ? [String(row[spec.last])] : []),
          ];
          if (id === codec.activeKeyId) {
            codec.decode(row.cipher, identity);
            continue;
          }
          const next = codec.reencrypt(row.cipher, identity);
          report.remaining++;
          if (options.apply) {
            const updated = await db.query(
              `UPDATE ${spec.table} SET ${spec.column}=$${keys.length + 1} WHERE ${keys.map((field, index) => `${field}=$${index + 1}`).join(" AND ")} AND ${spec.column}=$${keys.length + 2}`,
              [...after, next, row.cipher],
            );
            if (updated.rowCount !== 1)
              throw new Error("Workflow state changed during rotation.");
            report.changed++;
            report.remaining--;
          }
        }
        await db.query("COMMIT");
        if (rows.length < batch) break;
        if (n === max - 1) report.complete = false;
      } catch {
        await db.query("ROLLBACK").catch(() => {});
        throw new Error(
          "Workflow rotation stopped; keep all previous keys and run verification again.",
        );
      } finally {
        db.release();
      }
    }
  }
  return report;
}
