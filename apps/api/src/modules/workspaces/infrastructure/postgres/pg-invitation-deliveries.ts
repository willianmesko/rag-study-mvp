import { retryDelayMs } from "../../../../platform/integrations/retry-policy.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { InvitationDeliveryHistory, InvitationDeliveryRecord } from "../../application/ports/invitation-delivery-history.js";
import {
  InvitationDeliveryError,
  type InvitationDeliveryRepository,
  type InvitationLease,
  type InvitationReceipt,
} from "../../application/integrations/workspace-invitations.js";
export class PgInvitationDeliveries implements InvitationDeliveryRepository, InvitationDeliveryHistory {
  constructor(private readonly pool: Pool) {}
  private async owner(db: PoolClient, tenant: string, actor: string) {
    if (
      !(
        await db.query(
          "SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 AND role='owner' FOR SHARE",
          [tenant, actor],
        )
      ).rowCount
    )
      throw new InvitationDeliveryError("forbidden");
  }
  private async audit(
    db: PoolClient,
    scope: { tenantId: string; actorId: string; requestId: string },
    id: string,
    code: string,
  ) {
    await db.query(
      "INSERT INTO audit_events(tenant_id,actor_user_id,action,resource_type,resource_id,request_id,metadata) VALUES($1,$2,'workspace.invitation_delivery','workspace_invitation',$3,$4,jsonb_build_object('reason',$5::text))",
      [scope.tenantId, scope.actorId, id, scope.requestId, code],
    );
  }
  async list(tenantId: string): Promise<InvitationDeliveryRecord[]> {
    return (
      await this.pool.query<InvitationDeliveryRecord>(
        "SELECT id,email,role,CASE WHEN state='sending' AND lease_until<=clock_timestamp() THEN 'ambiguous' ELSE state END AS state,attempts,last_code AS reason,created_at,updated_at FROM workspace_invitation_requests WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50",
        [tenantId],
      )
    ).rows;
  }
  async prune() {
    await this.pool.query(
      "DELETE FROM workspace_invitation_requests WHERE created_at<clock_timestamp()-interval '90 days' AND (state<>'sending' OR lease_until<clock_timestamp())",
    );
  }
  async begin(input: Parameters<InvitationDeliveryRepository["begin"]>[0]) {
    const db = await this.pool.connect();
    let committed = false;
    try {
      await db.query("BEGIN");
      await db.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [
        input.tenantId,
      ]);
      await this.owner(db, input.tenantId, input.actorId);
      const {
        rows: [prior],
      } = await db.query(
        "SELECT * FROM workspace_invitation_requests WHERE tenant_id=$1 AND actor_id=$2 AND key_hash=$3 FOR UPDATE",
        [input.tenantId, input.actorId, input.keyHash],
      );
      if (prior) {
        if (prior.request_hash !== input.requestHash)
          throw new InvitationDeliveryError("idempotency_conflict");
        if (prior.state === "completed") {
          const current = await db.query(
            "SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
            [input.tenantId, prior.result_user_id],
          );
          if (!current.rowCount)
            throw new InvitationDeliveryError("stale_state");
          await db.query("COMMIT");
          return {
            result: {
              userId: prior.result_user_id,
              email: prior.email,
              role: prior.result_role,
            } as InvitationReceipt,
          };
        }
        if (prior.state === "sending" && prior.lease_until <= new Date()) {
          await db.query(
            "UPDATE workspace_invitation_requests SET state='ambiguous',last_code='lease_expired',updated_at=clock_timestamp() WHERE id=$1",
            [prior.id],
          );
          await this.audit(db, input, prior.id, "lease_expired");
          await db.query("COMMIT");
          committed = true;
          throw new InvitationDeliveryError("delivery_uncertain");
        }
        if (prior.state === "retryable" && prior.available_at > new Date())
          throw new InvitationDeliveryError("delivery_pending");
        if (prior.state !== "retryable" || prior.attempts >= 3)
          throw new InvitationDeliveryError(
            prior.state === "ambiguous"
              ? "delivery_uncertain"
              : prior.state === "sending"
                ? "delivery_pending"
                : "delivery_rejected",
          );
      }
      const known = await db.query(
        "SELECT 1 FROM workspace_invitations i JOIN tenant_memberships m ON m.tenant_id=i.tenant_id AND m.user_id=i.invited_user_id WHERE i.tenant_id=$1 AND i.email=$2",
        [input.tenantId, input.email],
      );
      if (known.rowCount) throw new InvitationDeliveryError("already_member");
      const active = await db.query(
        "SELECT 1 FROM workspace_invitation_requests WHERE tenant_id=$1 AND email=$2 AND state IN ('sending','ambiguous') AND id<>$3",
        [input.tenantId, input.email, prior?.id ?? randomUUID()],
      );
      if (active.rowCount)
        throw new InvitationDeliveryError("delivery_pending");
      const token = randomUUID();
      const {
        rows: [row],
      } = await db.query(
        `INSERT INTO workspace_invitation_requests(tenant_id,actor_id,key_hash,request_hash,email,role,state,lease_token,lease_until)
        VALUES($1,$2,$3,$4,$5,$6,'sending',$7,clock_timestamp()+interval '60 seconds') ON CONFLICT(tenant_id,actor_id,key_hash)
        DO UPDATE SET state='sending',attempts=workspace_invitation_requests.attempts+1,lease_token=$7,lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp() RETURNING id`,
        [
          input.tenantId,
          input.actorId,
          input.keyHash,
          input.requestHash,
          input.email,
          input.role,
          token,
        ],
      );
      await this.audit(db, input, row.id, "attempt_started");
      await db.query("COMMIT");
      return { lease: { ...input, id: row.id, leaseToken: token } };
    } catch (error) {
      if (!committed) await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async complete(lease: InvitationLease, userId: string) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [
        lease.tenantId,
      ]);
      await this.owner(db, lease.tenantId, lease.actorId);
      const locked = await db.query(
        "SELECT 1 FROM workspace_invitation_requests WHERE tenant_id=$1 AND id=$2 AND lease_token=$3 AND state='sending' AND lease_until>clock_timestamp() FOR UPDATE",
        [lease.tenantId, lease.id, lease.leaseToken],
      );
      if (!locked.rowCount)
        throw new InvitationDeliveryError("delivery_uncertain");
      await db.query(
        "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO NOTHING",
        [lease.tenantId, userId, lease.role],
      );
      const {
        rows: [member],
      } = await db.query(
        "SELECT role FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
        [lease.tenantId, userId],
      );
      await db.query(
        `INSERT INTO workspace_invitations(tenant_id,email,role,invited_by,invited_user_id) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(tenant_id,email) DO UPDATE SET role=excluded.role,invited_by=excluded.invited_by,invited_user_id=excluded.invited_user_id,status='pending',invited_at=NOW(),expires_at=NOW()+interval '7 days'`,
        [lease.tenantId, lease.email, lease.role, lease.actorId, userId],
      );
      await db.query(
        "UPDATE workspace_invitation_requests SET state='completed',result_user_id=$4,result_role=$5,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2 AND lease_token=$3",
        [lease.tenantId, lease.id, lease.leaseToken, userId, member.role],
      );
      await this.audit(db, lease, lease.id, "completed");
      await db.query("COMMIT");
      return {
        userId,
        email: lease.email,
        role: member.role,
      } as InvitationReceipt;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async fail(
    lease: InvitationLease,
    code: "rate_limited" | "permanent_rejection" | "outcome_unknown",
  ) {
    const state = {
      rate_limited: "retryable",
      permanent_rejection: "failed",
      outcome_unknown: "ambiguous",
    }[code];
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const prior = (
        await db.query(
          "SELECT attempts FROM workspace_invitation_requests WHERE tenant_id=$1 AND id=$2 AND lease_token=$3 FOR UPDATE",
          [lease.tenantId, lease.id, lease.leaseToken],
        )
      ).rows[0];
      const delay = retryDelayMs(prior?.attempts ?? 1, { baseMs: 1000 });
      const changed = await db.query(
        "UPDATE workspace_invitation_requests SET state=$4,last_code=$5,available_at=clock_timestamp()+$6*interval '1 millisecond',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2 AND lease_token=$3 AND state='sending' RETURNING id",
        [lease.tenantId, lease.id, lease.leaseToken, state, code, delay],
      );
      if (changed.rowCount) await this.audit(db, lease, lease.id, code);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
}
