import type { PoolClient } from "pg";
import { currentExecution } from "../../application/workflows/execution-context.js";
import { WorkflowGuardError } from "../../application/workflows/types.js";

/** Use the same short transaction that commits an effect; never hold this lock across a provider call. */
export async function lockWorkflowFence(client: PoolClient, tenantId: string) {
  const current = currentExecution();
  if (!current) return;
  const { lease } = current;
  if (tenantId !== lease.tenantId)
    throw new WorkflowGuardError("authorization_revoked");
  const r = await client.query(
    `SELECT 1 FROM workflow_runs WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3
    AND lease_token=$4 AND status='running' AND lease_until>clock_timestamp() AND deadline_at>clock_timestamp() FOR UPDATE`,
    [lease.tenantId, lease.actorId, lease.runId, lease.leaseToken],
  );
  if (!r.rowCount) throw new WorkflowGuardError("lease_lost");
  if (lease.kind !== "ingestion") {
    const member = await client.query(
      "SELECT role FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2::uuid FOR SHARE",
      [tenantId, lease.actorId],
    );
    if (
      !member.rowCount ||
      (lease.kind === "evaluation" && member.rows[0]?.role !== "owner")
    )
      throw new WorkflowGuardError("authorization_revoked");
    if (lease.kind === "evaluation" && lease.approvedBy) {
      const approval = await client.query(
        "SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 AND role='owner' FOR SHARE",
        [tenantId, lease.approvedBy],
      );
      if (!approval.rowCount)
        throw new WorkflowGuardError("authorization_revoked");
    }
  }
}
