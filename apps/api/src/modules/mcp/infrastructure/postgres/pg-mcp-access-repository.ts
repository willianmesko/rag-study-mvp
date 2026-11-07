import type { Pool } from "pg";
import type { McpAccessRepository, McpAdmission } from "../../application/access.js";
import type { TenantRole } from "../../../workspaces/index.js";

const tokenLifetime = "15 minutes";
const minuteLimit = 10;
const tokenLimit = 40;

export class PgMcpAccessRepository implements McpAccessRepository {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async save({ tenantId, userId, digest }: Parameters<McpAccessRepository["save"]>[0]): Promise<Date> {
    const { rows } = await this.pool.query<{ expires_at: Date }>(
      `INSERT INTO workspace_mcp_access (tenant_id, user_id, token_digest, expires_at)
       VALUES ($1, $2, $3, clock_timestamp() + $4::interval)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET
         token_digest = EXCLUDED.token_digest, expires_at = EXCLUDED.expires_at, issued_calls = 0
       RETURNING expires_at`,
      [tenantId, userId, digest, tokenLifetime]
    );
    return rows[0]!.expires_at;
  }

  async expiresAt({ tenantId, userId }: Parameters<McpAccessRepository["expiresAt"]>[0]): Promise<Date | null> {
    const { rows } = await this.pool.query<{ expires_at: Date }>(
      `SELECT expires_at FROM workspace_mcp_access
       WHERE tenant_id = $1 AND user_id = $2 AND expires_at > clock_timestamp()`,
      [tenantId, userId]
    );
    return rows[0]?.expires_at ?? null;
  }

  async revoke({ tenantId, userId }: Parameters<McpAccessRepository["revoke"]>[0]): Promise<void> {
    await this.pool.query(
      `UPDATE workspace_mcp_access SET token_digest = NULL, expires_at = NULL WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId]
    );
  }

  async admit({ tenantId, digest }: Parameters<McpAccessRepository["admit"]>[0]): Promise<McpAdmission | null> {
    const { rows } = await this.pool.query<{ user_id: string; role: TenantRole; allowed: boolean }>(
      `UPDATE workspace_mcp_access AS access
       SET window_calls = CASE
             WHEN access.window_started_at <= statement_timestamp() - interval '1 minute' THEN 1
             ELSE LEAST(access.window_calls + 1, $3::integer + 1)
           END,
           window_started_at = CASE
             WHEN access.window_started_at <= statement_timestamp() - interval '1 minute' THEN statement_timestamp()
             ELSE access.window_started_at
           END,
           issued_calls = LEAST(access.issued_calls + 1, $4::integer + 1)
       FROM tenant_memberships AS member
       WHERE access.tenant_id = $1 AND access.token_digest = $2 AND access.expires_at > clock_timestamp()
         AND member.tenant_id = access.tenant_id AND member.user_id = access.user_id
       RETURNING access.user_id, member.role, access.window_calls <= $3::integer AND access.issued_calls <= $4::integer AS allowed`,
      [tenantId, digest, minuteLimit, tokenLimit]
    );
    const row = rows[0];
    return row ? { tenantId, userId: row.user_id, role: row.role, allowed: row.allowed } : null;
  }
  async validate({ tenantId, digest }: Parameters<McpAccessRepository["validate"]>[0]): Promise<McpAdmission | null> {
    const { rows } = await this.pool.query<{ user_id: string; role: TenantRole }>(`SELECT a.user_id,m.role FROM workspace_mcp_access a
      JOIN tenant_memberships m ON m.tenant_id=a.tenant_id AND m.user_id=a.user_id
      WHERE a.tenant_id=$1 AND a.token_digest=$2 AND a.expires_at>clock_timestamp()`, [tenantId,digest]);
    const member = rows[0];
    return member ? { tenantId, userId: member.user_id, role: member.role, allowed: true } : null;
  }
}
