import assert from "node:assert/strict";
import { uuid } from "./fixtures.mjs";

const kinds = ["chat", "evaluation", "ingestion"];
const counts = ["queued", "ready", "running", "leased", "expiredLeases", "missingLeases", "waitingApproval"];
export function queueReceipt(rows) {
  assert.equal(rows.length, 3, "Queue metric kinds were incomplete.");
  assert.deepEqual(rows.map(({ kind }) => kind).sort(), kinds);
  return rows.map((row) => {
    for (const name of counts) assert.ok(Number.isSafeInteger(row[name]) && row[name] >= 0, "Invalid queue count.");
    assert.ok(row.ready <= row.queued, "Ready work exceeded queued work.");
    assert.equal(row.leased + row.expiredLeases + row.missingLeases, row.running, "Lease categories did not reconcile.");
    for (const [count, age] of [[row.ready, row.oldestReadyMs], [row.expiredLeases, row.oldestExpiredLeaseMs]])
      assert.ok(count === 0 ? age === null : Number.isFinite(age) && age >= 0, "Queue age did not match its population.");
    return { kind: row.kind, ...Object.fromEntries(counts.map((name) => [name, row[name]])),
      oldestReadyMs: row.oldestReadyMs, oldestExpiredLeaseMs: row.oldestExpiredLeaseMs };
  });
}
export async function captureWorkflowQueues(pool, tenantIds) {
  assert.ok(tenantIds.length > 0 && tenantIds.length <= 10 &&
    tenantIds.every((id) => /^20000000-0000-4000-8000-\d{12}$/.test(id)), "Only synthetic workspace queue scopes are allowed.");
  const { rows } = await pool.query(`WITH kinds(kind) AS (VALUES ('chat'),('evaluation'),('ingestion')), sample AS (SELECT NOW() AS at)
    SELECT k.kind,
      COUNT(r.run_id) FILTER(WHERE r.status='queued')::int AS queued,
      COUNT(r.run_id) FILTER(WHERE r.status='queued' AND r.available_at<=s.at)::int AS ready,
      COUNT(r.run_id) FILTER(WHERE r.status='running')::int AS running,
      COUNT(r.run_id) FILTER(WHERE r.status='running' AND r.lease_token IS NOT NULL AND r.lease_until>s.at)::int AS leased,
      COUNT(r.run_id) FILTER(WHERE r.status='running' AND r.lease_token IS NOT NULL AND r.lease_until<=s.at)::int AS "expiredLeases",
      COUNT(r.run_id) FILTER(WHERE r.status='running' AND (r.lease_token IS NULL OR r.lease_until IS NULL))::int AS "missingLeases",
      COUNT(r.run_id) FILTER(WHERE r.status='waiting_approval')::int AS "waitingApproval",
      (MAX(EXTRACT(EPOCH FROM(s.at-GREATEST(r.created_at,r.available_at)))*1000)
        FILTER(WHERE r.status='queued' AND r.available_at<=s.at))::float8 AS "oldestReadyMs",
      (MAX(EXTRACT(EPOCH FROM(s.at-r.lease_until))*1000)
        FILTER(WHERE r.status='running' AND r.lease_token IS NOT NULL AND r.lease_until<=s.at))::float8 AS "oldestExpiredLeaseMs"
    FROM kinds k CROSS JOIN sample s LEFT JOIN workflow_runs r ON r.kind=k.kind AND r.tenant_id=ANY($1::uuid[])
      AND r.status IN ('queued','running','waiting_approval') GROUP BY k.kind ORDER BY k.kind`, [tenantIds]);
  return queueReceipt(rows);
}

// Runs before the API exists. These exact synthetic rows are removed even when
// assertions fail; opaque state is never decrypted or dispatched to a worker.
export async function verifyWorkflowQueueFixture(pool, workspace) {
  const ids = Array.from({ length: 6 }, (_, index) => uuid(8, index + 1));
  const budget = { maxSteps: 1, maxCalls: 1, maxInputTokens: 1, maxOutputTokens: 0, maxCostMicros: 0, timeoutMs: 600000 };
  let populated, isolated;
  try {
    for (const [index, status] of ["queued", "queued", "running", "running", "running", "waiting_approval"].entries())
      await pool.query(`INSERT INTO workflow_runs(tenant_id,actor_id,run_id,kind,version,input_hash,input_cipher,budget,status,
        created_at,available_at,deadline_at,lease_token,lease_until)
        VALUES($1,$2,$3,$9,'capacity-queue-metric-v1',$4,$5,$6,$7,NOW()-interval '1 hour',
          CASE WHEN $8::int=1 THEN NOW()+interval '1 hour' ELSE NOW()-interval '1 second' END,
          NOW()+interval '10 minutes',CASE WHEN $8::int IN (2,3) THEN gen_random_uuid() ELSE NULL END,
          CASE WHEN $8::int=2 THEN NOW()+interval '30 seconds' WHEN $8::int=3 THEN NOW()-interval '1 second' ELSE NULL END)`,
      [workspace.tenantId, workspace.actors[0], ids[index], "0".repeat(64), Buffer.alloc(32), budget, status, index,
        index === 5 ? "evaluation" : "chat"]);
    populated = await captureWorkflowQueues(pool, [workspace.tenantId]);
    const chat = populated.find(({ kind }) => kind === "chat");
    assert.deepEqual(counts.map((name) => chat[name]), [2, 1, 3, 1, 1, 1, 0]);
    assert.equal(populated.find(({ kind }) => kind === "evaluation").waitingApproval, 1);
    assert.ok(chat.oldestReadyMs >= 1000 && chat.oldestReadyMs < 60000);
    assert.ok(chat.oldestExpiredLeaseMs >= 1000 && chat.oldestExpiredLeaseMs < 60000);
    isolated = await captureWorkflowQueues(pool, [uuid(2, 900)]);
    assert.ok(isolated.every((row) => counts.every((name) => row[name] === 0)));
  } finally {
    await pool.query("DELETE FROM workflow_runs WHERE tenant_id=$1 AND run_id=ANY($2::uuid[])", [workspace.tenantId, ids]);
  }
  const empty = await captureWorkflowQueues(pool, [workspace.tenantId]);
  assert.ok(empty.every((row) => counts.every((name) => row[name] === 0)));
  return { populated, isolated, empty, workDispatched: false };
}
