import type { Pool } from "pg";
import type { TenantMembershipRepository, TenantRole } from "../../application/ports/tenant-membership-repository.js";

type Row = { tenant_id: string; tenant_name: string; tenant_slug: string; role: TenantRole };
type MemberRow = { user_id: string; role: TenantRole; created_at: Date };

export class PgTenantMembershipRepository implements TenantMembershipRepository {
  constructor(private readonly pool: Pool) {}

  async findPrimaryByUserId(userId: string) {
    const result = await this.pool.query<Row>(
      "SELECT m.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, m.role FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id = $1 ORDER BY m.created_at LIMIT 1",
      [userId]
    );
    const row = result.rows[0];
    return row ? { tenantId: row.tenant_id, tenantName: row.tenant_name, tenantSlug: row.tenant_slug, role: row.role } : null;
  }
  async listByUserId(userId: string) { const result = await this.pool.query<Row>("SELECT m.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, m.role FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 ORDER BY t.name", [userId]); return result.rows.map((row) => ({ tenantId: row.tenant_id, tenantName: row.tenant_name, tenantSlug: row.tenant_slug, role: row.role })); }
  async findByUserAndTenant(userId: string, tenantId: string) { const result = await this.pool.query<Row>("SELECT m.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, m.role FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.tenant_id=$2", [userId, tenantId]); const row=result.rows[0]; return row ? { tenantId: row.tenant_id, tenantName: row.tenant_name, tenantSlug: row.tenant_slug, role: row.role } : null; }
  async createWorkspace(input: { userId: string; name: string; slug: string }) { const client=await this.pool.connect(); try { await client.query("BEGIN"); const tenant=await client.query<{id:string}>("INSERT INTO tenants (id, name, slug) VALUES (gen_random_uuid(),$1,$2) RETURNING id",[input.name,input.slug]); const id=tenant.rows[0]!.id; await client.query("INSERT INTO tenant_memberships (tenant_id,user_id,role) VALUES ($1,$2,'owner')",[id,input.userId]); await client.query("COMMIT"); return {tenantId:id,tenantName:input.name,tenantSlug:input.slug,role:"owner" as const}; } catch(e){await client.query("ROLLBACK");throw e;} finally{client.release();} }
  async listMembers(tenantId: string) {
    const result = await this.pool.query<MemberRow>("SELECT user_id, role, created_at FROM tenant_memberships WHERE tenant_id=$1 ORDER BY created_at", [tenantId]);
    return result.rows.map((row) => ({ userId: row.user_id, role: row.role, createdAt: row.created_at }));
  }
  async addMember(input: { tenantId: string; userId: string; role: Exclude<TenantRole, "owner"> }) {
    await this.pool.query(
      "INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, user_id) DO UPDATE SET role=EXCLUDED.role",
      [input.tenantId, input.userId, input.role]
    );
  }
  async changeMemberRole(input: { tenantId: string; userId: string; role: Exclude<TenantRole, "owner"> }) {
    const result = await this.pool.query(
      "UPDATE tenant_memberships SET role=$3 WHERE tenant_id=$1 AND user_id=$2 AND role <> 'owner'",
      [input.tenantId, input.userId, input.role]
    );
    return result.rowCount === 1;
  }
  async removeMember(input: { tenantId: string; userId: string }) {
    const result = await this.pool.query(
      "DELETE FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 AND role <> 'owner'",
      [input.tenantId, input.userId]
    );
    return result.rowCount === 1;
  }
  async recordInvitation(input: { tenantId: string; email: string; role: Exclude<TenantRole, "owner">; invitedBy: string; invitedUserId: string }) {
    await this.pool.query(
      "INSERT INTO workspace_invitations (tenant_id, email, role, invited_by, invited_user_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, email) DO UPDATE SET role=EXCLUDED.role, invited_by=EXCLUDED.invited_by, invited_user_id=EXCLUDED.invited_user_id, status='pending', invited_at=NOW(), accepted_at=NULL, expires_at=NOW() + INTERVAL '7 days'",
      [input.tenantId, input.email, input.role, input.invitedBy, input.invitedUserId]
    );
  }
}
