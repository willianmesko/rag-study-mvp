import type { Pool, PoolClient } from "pg";
import { AgentActionError, type AgentActionIdentity, type AgentActionReason, type AgentActionRepository,
  type AgentActionSnapshot, type AgentActionStatus } from "../../application/agent-actions/agent-action-service.js";
import { agentActionAttemptLimit, type AgentActionFailure, type AgentActionLease, type AgentActionWorkerRepository } from "../../application/agent-actions/agent-action-worker.js";
import type { CreateEvaluationRun } from "../../../evaluations/index.js";
import { PgEvaluationRepository } from "../../../evaluations/index.js";
import { applyPostgresDeadlines, postgresDeadlineProfiles } from "../../../../platform/database/sql-boundary.js";

type ActionRow = {
  id: string;
  tenant_id: string;
  requested_by: string;
  approved_by: string | null;
  status: AgentActionStatus;
  attempts: number;
  evaluation_run_id: string | null;
  created_at: Date;
  expires_at: Date;
  expired: boolean;
};

const columns = `id, tenant_id, requested_by, approved_by, status, attempts, evaluation_run_id, created_at,
  expires_at, expires_at <= clock_timestamp() AS expired`;

export class PgAgentActionRepository implements AgentActionRepository, AgentActionWorkerRepository {
  constructor(private readonly pool: Pool) {}

  request({ tenantId, userId, keyHash }: { tenantId: string; userId: string; keyHash: string }) {
    return this.transaction(async (client) => {
      await lockWorkspace(client, tenantId);
      await requireOwner(client, tenantId, userId);
      const existing = (await client.query<ActionRow>(
        `SELECT ${columns} FROM agent_actions
         WHERE tenant_id = $1 AND requested_by = $2 AND idempotency_key_hash = $3 FOR SHARE`,
        [tenantId, userId, keyHash]
      )).rows[0];
      if (existing) return snapshot(client, existing);
      const active = (await client.query<ActionRow>(
        `SELECT ${columns} FROM agent_actions
         WHERE tenant_id = $1 AND status IN ('pending_approval', 'queued', 'running') FOR UPDATE`, [tenantId]
      )).rows[0];
      if (active) {
        if (active.status === "running") throw new AgentActionError("conflict");
        if (active.expired) await terminate(client, active, "approval_expired");
        else if (!await ownersStillAuthorized(client, active)) await terminate(client, active, "owner_revoked");
        else throw new AgentActionError("conflict");
      }
      const created = (await client.query<ActionRow>(
        `INSERT INTO agent_actions (tenant_id, requested_by, idempotency_key_hash, action, status)
         VALUES ($1, $2, $3, 'run_evaluation', 'pending_approval') RETURNING ${columns}`, [tenantId, userId, keyHash]
      )).rows[0]!;
      await addEvent(client, created, "pending_approval", "requested", userId);
      return snapshot(client, created);
    });
  }

  approve({ tenantId, userId, actionId }: AgentActionIdentity) {
    return this.transaction(async (client) => {
      await lockWorkspace(client, tenantId);
      const action = (await client.query<ActionRow>(
        `SELECT ${columns} FROM agent_actions WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, actionId]
      )).rows[0];
      await requireOwner(client, tenantId, userId);
      if (!action) throw new AgentActionError("not_found");
      if (action.approved_by) return snapshot(client, action);
      if (action.status !== "pending_approval" || action.expired) throw new AgentActionError("conflict");
      await requireOwner(client, tenantId, action.requested_by);
      const approved = (await client.query(
        `SELECT id FROM agent_actions WHERE tenant_id = $1 AND approved_at > clock_timestamp() - INTERVAL '1 day' LIMIT 2`,
        [tenantId]
      )).rows.length;
      if (approved >= 2) throw new AgentActionError("rate_limited");
      const queued = (await client.query<ActionRow>(
        `UPDATE agent_actions SET status = 'queued', approved_by = $3, approved_at = clock_timestamp(),
           ready_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2 RETURNING ${columns}`, [tenantId, actionId, userId]
      )).rows[0]!;
      await addEvent(client, queued, "queued", "approved", userId);
      return snapshot(client, queued);
    });
  }

  get({ tenantId, userId, actionId }: AgentActionIdentity) {
    return this.transaction(async (client) => {
      await requireOwner(client, tenantId, userId);
      const action = (await client.query<ActionRow>(
        `SELECT ${columns} FROM agent_actions WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [tenantId, actionId]
      )).rows[0];
      if (!action) throw new AgentActionError("not_found");
      return snapshot(client, action);
    });
  }

  claim(leaseMs: number) {
    return this.transaction(async (client) => {
      const action = (await client.query<ActionRow>(
        `SELECT ${columns} FROM agent_actions
         WHERE (status = 'queued' AND ready_at <= clock_timestamp())
            OR (status IN ('pending_approval', 'queued') AND expires_at <= clock_timestamp())
            OR (status = 'running' AND lease_until <= clock_timestamp())
         ORDER BY ready_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`
      )).rows[0];
      if (!action) return null;
      if (action.expired) {
        await terminate(client, action, "approval_expired");
        return null;
      }
      if (!await ownersStillAuthorized(client, action)) {
        await terminate(client, action, "owner_revoked");
        return null;
      }
      if (action.status === "running") {
        await retryOrTerminate(client, action, "lease_expired");
        return null;
      }
      const claimed = (await client.query<{ lease_id: string; attempts: number }>(
        `UPDATE agent_actions SET status = 'running', attempts = attempts + 1,
           lease_id = gen_random_uuid(), lease_until = clock_timestamp() + $3::int * INTERVAL '1 millisecond'
         WHERE tenant_id = $1 AND id = $2 RETURNING lease_id, attempts`,
        [action.tenant_id, action.id, leaseMs]
      )).rows[0]!;
      await addEvent(client, action, "running", "started");
      return { tenantId: action.tenant_id, actionId: action.id, leaseId: claimed.lease_id, attempt: claimed.attempts };
    });
  }

  complete(lease: AgentActionLease, result: CreateEvaluationRun) {
    if (lease.tenantId !== result.tenantId) throw new Error("Action result does not match the lease workspace.");
    return this.transaction(async (client) => {
      const action = await lockedLease(client, lease);
      if (!action) return;
      if (action.expired) return terminate(client, action, "approval_expired");
      if (!await ownersStillAuthorized(client, action)) return terminate(client, action, "owner_revoked");
      const evaluation = await new PgEvaluationRepository(client).create(result);
      const updated = await client.query(
        `UPDATE agent_actions SET status = 'succeeded', evaluation_run_id = $3, lease_id = NULL, lease_until = NULL
         WHERE tenant_id = $1 AND id = $2 AND lease_until > clock_timestamp()`,
        [lease.tenantId, lease.actionId, evaluation.id]
      );
      if (!updated.rowCount) throw new Error("The action lease expired while committing its result.");
      await addEvent(client, action, "succeeded", "completed");
    });
  }

  fail(lease: AgentActionLease, reason: AgentActionFailure) {
    return this.transaction(async (client) => {
      const action = await lockedLease(client, lease);
      if (action) await retryOrTerminate(client, action, reason);
    });
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let unusable = false;
    try {
      await client.query("BEGIN");
      await applyPostgresDeadlines(client, { ...postgresDeadlineProfiles.runtime, statementMs: 3_000, lockMs: 1_000 }, true);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { unusable = true; }
      throw error;
    } finally {
      client.release(unusable);
    }
  }
}

async function lockWorkspace(client: PoolClient, tenantId: string) {
  await client.query("SELECT id FROM tenants WHERE id = $1 FOR NO KEY UPDATE", [tenantId]);
}

async function requireOwner(client: PoolClient, tenantId: string, userId: string) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2 AND role = 'owner' FOR SHARE`,
    [tenantId, userId]
  );
  if (!rowCount) throw new AgentActionError("forbidden");
}

async function ownersStillAuthorized(client: PoolClient, action: ActionRow) {
  const ids = [...new Set(action.approved_by ? [action.requested_by, action.approved_by] : [action.requested_by])].sort();
  const { rowCount } = await client.query(
    `SELECT 1 FROM tenant_memberships WHERE tenant_id = $1 AND user_id = ANY($2::uuid[]) AND role = 'owner'
     ORDER BY user_id FOR SHARE`, [action.tenant_id, ids]
  );
  return rowCount === ids.length;
}

async function lockedLease(client: PoolClient, lease: AgentActionLease) {
  return (await client.query<ActionRow>(
    `SELECT ${columns} FROM agent_actions WHERE tenant_id = $1 AND id = $2 AND status = 'running'
       AND lease_id = $3 AND lease_until > clock_timestamp() FOR UPDATE`,
    [lease.tenantId, lease.actionId, lease.leaseId]
  )).rows[0];
}

async function terminate(client: PoolClient, action: ActionRow, reason: AgentActionReason) {
  await client.query(
    "UPDATE agent_actions SET status = 'dead_letter', lease_id = NULL, lease_until = NULL WHERE tenant_id = $1 AND id = $2",
    [action.tenant_id, action.id]
  );
  await addEvent(client, action, "dead_letter", reason);
}

async function retryOrTerminate(client: PoolClient, action: ActionRow, reason: AgentActionFailure) {
  if (action.attempts >= agentActionAttemptLimit) return terminate(client, action, reason);
  await client.query(
    `UPDATE agent_actions SET status = 'queued', lease_id = NULL, lease_until = NULL,
       ready_at = clock_timestamp() + $3::int * INTERVAL '1 second' WHERE tenant_id = $1 AND id = $2`,
    [action.tenant_id, action.id, 2 ** action.attempts]
  );
  await addEvent(client, action, "queued", reason);
}

async function addEvent(client: PoolClient, action: ActionRow, status: AgentActionStatus, reason: AgentActionReason, actorId: string | null = null) {
  await client.query(
    "INSERT INTO agent_action_events (tenant_id, action_id, actor_user_id, status, reason) VALUES ($1, $2, $3, $4, $5)",
    [action.tenant_id, action.id, actorId, status, reason]
  );
}

async function snapshot(client: PoolClient, action: ActionRow): Promise<AgentActionSnapshot> {
  const events = await client.query<AgentActionSnapshot["events"][number]>(
    `SELECT status, reason, created_at AS at FROM agent_action_events WHERE tenant_id = $1 AND action_id = $2 ORDER BY sequence`,
    [action.tenant_id, action.id]
  );
  return {
    id: action.id,
    action: "run_evaluation",
    status: action.status,
    attempts: action.attempts,
    evaluationRunId: action.evaluation_run_id,
    createdAt: action.created_at,
    expiresAt: action.expires_at,
    events: events.rows
  };
}
