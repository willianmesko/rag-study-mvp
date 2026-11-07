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
    // Keyset by physical row is only for this bounded scan; never persisted as an identifier.
    let after = "(0,0)";
    for (let n = 0; n < max; n++) {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        await db.query("SET LOCAL statement_timeout='5s'");
        await db.query("SET LOCAL lock_timeout='500ms'");
        const prefix = codec.activeEnvelopePrefix;
        const { rows } = await db.query(
          `SELECT ctid::text AS row_id,to_jsonb(t)-'${spec.column}' AS fields,${spec.column} AS cipher FROM ${spec.table} t WHERE ${spec.column} IS NOT NULL AND ctid>$1::tid ${options.apply ? `AND substring(${spec.column} from 1 for $3)<>$4` : ""} ORDER BY ctid LIMIT $2 FOR UPDATE`,
          options.apply
            ? [after, batch, prefix.length, prefix]
            : [after, batch],
        );
        for (const row of rows) {
          after = row.row_id;
          report.examined++;
          const id = codec.keyId(row.cipher);
          report.byKey[id] = (report.byKey[id] ?? 0) + 1;
          const identity = [
            ...spec.identity.map((field) => String(row.fields[field])),
            ...spec.suffix,
            ...("last" in spec ? [String(row.fields[spec.last])] : []),
          ];
          if (id === codec.activeKeyId) {
            codec.decode(row.cipher, identity);
            continue;
          }
          const next = codec.reencrypt(row.cipher, identity);
          report.remaining++;
          if (options.apply) {
            await db.query(
              `UPDATE ${spec.table} SET ${spec.column}=$2 WHERE ctid=$1::tid AND ${spec.column}=$3`,
              [row.row_id, next, row.cipher],
            );
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
