import type { Pool } from "pg";
import type { AuditEventRepository } from "../../application/ports/audit-event-repository.js";

export class PgAuditEventRepository implements AuditEventRepository {
  constructor(private readonly pool: Pool) {}

  async record(input: Parameters<AuditEventRepository["record"]>[0]): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_events (tenant_id, actor_user_id, action, resource_type, resource_id, request_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        input.tenantId,
        input.actorUserId,
        input.action,
        input.resourceType,
        input.resourceId,
        input.requestId,
        JSON.stringify(input.metadata)
      ]
    );
  }
}
