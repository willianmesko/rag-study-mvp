import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool, type PoolClient } from "pg";
import { WorkflowStateCodec } from "../security/workflow-state-codec.js";
import { PgWorkflowRepository } from "./pg-workflow-repository.js";
import { rotateWorkflowKeys } from "./rotate-workflow-keys.js";

const url = process.env.MCP_TEST_DATABASE_URL;
const stores = [
  {
    table: "workflow_runs",
    column: "input_cipher",
    key: "run_id",
    touch: "updated_at=clock_timestamp(),lease_until=clock_timestamp()+interval '30 seconds'",
  },
  {
    table: "workflow_checkpoints",
    column: "cipher",
    key: "checkpoint_id",
    touch: "encoding=encoding",
  },
  {
    table: "workflow_writes",
    column: "cipher",
    key: "ordinal",
    touch: "task_path=task_path",
  },
  {
    table: "workflow_effects",
    column: "cipher",
    key: "effect_key",
    touch: "attempts=attempts+1",
  },
] as const;

test("rotation traverses logical identities through row relocation and process loss in every encrypted store", { skip: !url, timeout: 40000 }, async (t) => {
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url!).hostname),
    "Use a disposable local database.",
  );
  for (const store of stores) await t.test(store.table, async (t) => {
    const schema = `rotation_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const options = {
      connectionString: url,
      max: 2,
      options: `-c search_path=${schema},public`,
    };
    const pool = new Pool(options);
    const instrumented: Pool[] = [];
    t.after(async () => {
      await Promise.all(instrumented.map((connection) => connection.end()));
      await pool.end();
      try {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        await admin.end();
      }
    });
    for (const name of ["tenants", "tenant_memberships", ...stores.map((entry) => entry.table)]) {
      await admin.query(
        `CREATE TABLE ${schema}.${name} (LIKE public.${name} INCLUDING ALL)`,
      );
    }
    const tenantId = randomUUID(), actorId = randomUUID();
    await pool.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Rotation fixture')",
      [tenantId, `rotation-${tenantId}`],
    );
    await pool.query(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [tenantId, actorId],
    );
    const legacyKey = randomBytes(32).toString("base64"),
      activeKey = randomBytes(32).toString("base64");
    const legacy = new WorkflowStateCodec(legacyKey);
    const codec = new WorkflowStateCodec({
      activeKeyId: "active",
      keys: { active: activeKey },
      legacyKey,
    });
    const retired = new WorkflowStateCodec({
      activeKeyId: "active",
      keys: { active: activeKey },
    });
    const budget = {
      maxSteps: 40,
      maxCalls: 40,
      maxInputTokens: 100000,
      maxOutputTokens: 8000,
      maxCostMicros: 50000,
      timeoutMs: 60000,
    };
    const parentRun = randomUUID();
    if (store.table !== "workflow_runs") {
      await new PgWorkflowRepository(pool, codec).admit({
        tenantId,
        actorId,
        runId: parentRun,
        kind: "evaluation",
        version: "fixture-v1",
        budget,
        input: {},
      });
    }

    const identities = new Map<string, string[]>();
    // Reverse physical insertion order is deliberate: a heap rewrite between
    // batches moves an unvisited old-key row behind a physical-row cursor.
    for (const ordinal of [10, 2, 1]) {
      const runId = `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
      const recordKey = store.table === "workflow_runs"
        ? runId
        : store.table === "workflow_writes"
          ? String(ordinal)
          : String(ordinal).padStart(2, "0");
      const base = [tenantId, actorId, parentRun];
      let identity: string[];
      if (store.table === "workflow_runs") {
        identity = [tenantId, actorId, runId, "input"];
        await new PgWorkflowRepository(pool, legacy).admit({
          tenantId,
          actorId,
          runId,
          kind: "evaluation",
          version: "fixture-v1",
          budget,
          input: { recordKey },
        });
        await pool.query(
          "UPDATE workflow_runs SET status='completed' WHERE run_id=$1",
          [runId],
        );
      } else if (store.table === "workflow_checkpoints") {
        identity = [...base, "graph", "namespace", recordKey];
        await pool.query(
          "INSERT INTO workflow_checkpoints(tenant_id,actor_id,run_id,graph_name,namespace,checkpoint_id,encoding,cipher) VALUES($1,$2,$3,'graph','namespace',$4,'json',$5)",
          [...base, recordKey, legacy.json({ recordKey }, identity)],
        );
      } else if (store.table === "workflow_writes") {
        identity = [...base, "graph", "namespace", "checkpoint", "task", recordKey];
        await pool.query(
          "INSERT INTO workflow_writes(tenant_id,actor_id,run_id,graph_name,namespace,checkpoint_id,task_id,task_path,ordinal,encoding,cipher) VALUES($1,$2,$3,'graph','namespace','checkpoint','task','',$4,'json',$5)",
          [...base, ordinal, legacy.json({ recordKey }, identity)],
        );
      } else {
        identity = [...base, "effect", recordKey];
        await pool.query(
          "INSERT INTO workflow_effects(tenant_id,actor_id,run_id,effect_key,cipher) VALUES($1,$2,$3,$4,$5)",
          [...base, recordKey, legacy.json({ recordKey }, identity)],
        );
      }
      identities.set(recordKey, identity);
    }
    const snapshot = async () => (
      await pool.query<{ record_key: string; cipher: Buffer; row_id: string }>(
        `SELECT ${store.key}::text AS record_key,${store.column} AS cipher,ctid::text AS row_id FROM ${store.table} ORDER BY ${store.key}`,
      )
    ).rows;
    const originals = await snapshot();
    const relocate = async () => {
      const before = await snapshot();
      // This is a separate PostgreSQL session after a committed rotation batch,
      // just as a concurrent heartbeat/checkpoint writer or maintenance worker.
      await pool.query(`UPDATE ${store.table} SET ${store.touch}`);
      const updated = await snapshot();
      assert.ok(
        updated.some((row, index) => row.row_id !== before[index].row_id),
        "the concurrent update must physically relocate tuples",
      );
      await pool.query(`CLUSTER ${store.table} USING ${store.table}_pkey`);
    };
    const interleave = (onCommit: () => Promise<void>) => {
      const connection = new Pool({ ...options, max: 1 });
      instrumented.push(connection);
      let performed = false;
      connection.on("connect", (client) => {
        const query = client.query.bind(client);
        let selectedTarget = false;
        client.query = (async (statement: string, values?: unknown[]) => {
          const result = await query(statement, values);
          if (
            statement.startsWith("SELECT ") &&
            statement.includes(`FROM ${store.table} `) &&
            result.rowCount
          ) selectedTarget = true;
          if (statement === "COMMIT" && selectedTarget && !performed) {
            performed = true;
            await onCommit();
          }
          return result;
        }) as PoolClient["query"];
      });
      return connection;
    };

    assert.equal(
      (await rotateWorkflowKeys(pool, codec, { apply: false })).remaining,
      3,
    );
    const concurrent = await rotateWorkflowKeys(interleave(relocate), codec, {
      apply: true,
      batchSize: 2,
    });
    assert.equal(
      concurrent.changed,
      3,
      "no old-key record may disappear behind the inventory cursor",
    );
    assert.equal(concurrent.complete, true);
    assert.equal(
      (await rotateWorkflowKeys(pool, retired, { apply: false })).remaining,
      0,
    );
    for (const row of await snapshot()) {
      assert.deepEqual(
        retired.parse(row.cipher, identities.get(row.record_key)!),
        { recordKey: row.record_key },
      );
    }

    // Recreate an old-key inventory, then stop the process immediately after a
    // committed first batch. A new invocation must find the unconverted records.
    for (const row of originals) {
      await pool.query(
        `UPDATE ${store.table} SET ${store.column}=$1 WHERE ${store.key}=$2`,
        [row.cipher, row.record_key],
      );
    }
    await assert.rejects(
      rotateWorkflowKeys(
        interleave(async () => {
          await relocate();
          throw new Error("simulated process loss after commit");
        }),
        codec,
        { apply: true, batchSize: 2 },
      ),
      /keep all previous keys/,
    );
    const interrupted = await snapshot();
    assert.equal(
      interrupted.filter((row) => codec.keyId(row.cipher) === "active").length,
      2,
      "the successful batch remains committed after process loss",
    );
    assert.equal(
      interrupted.filter((row) => codec.keyId(row.cipher) === "legacy").length,
      1,
    );
    const resumed = await rotateWorkflowKeys(pool, codec, {
      apply: true,
      batchSize: 1,
      maxBatches: 1,
    });
    assert.equal(resumed.changed, 1);
    assert.equal(
      resumed.complete,
      false,
      "a full final bounded batch still needs fresh verification",
    );
    const verification = await rotateWorkflowKeys(pool, retired, {
      apply: false,
      batchSize: 2,
    });
    assert.equal(verification.complete, true);
    assert.equal(verification.remaining, 0);
    assert.equal((await rotateWorkflowKeys(pool, codec, { apply: true })).changed, 0);
    for (const row of await snapshot()) {
      assert.deepEqual(
        retired.parse(row.cipher, identities.get(row.record_key)!),
        { recordKey: row.record_key },
      );
      assert.throws(
        () => retired.parse(row.cipher, [randomUUID(), ...identities.get(row.record_key)!.slice(1)]),
        /authentication failed/,
      );
    }
  });
});
