import type { Pool } from "pg";
import type { TenantMembershipRepository, TenantRole } from "../../application/ports/tenant-membership-repository.js";

type Row = { tenant_id: string; role: TenantRole };

export class PgTenantMembershipRepository implements TenantMembershipRepository {
  constructor(private readonly pool: Pool) {}

  async findPrimaryByUserId(userId: string) {
    const result = await this.pool.query<Row>(
      "SELECT tenant_id, role FROM tenant_memberships WHERE user_id = $1 ORDER BY created_at LIMIT 1",
      [userId]
    );
    const row = result.rows[0];
    return row ? { tenantId: row.tenant_id, role: row.role } : null;
  }
}
