import { createHash, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { mcpReadToolNames, type McpReadToolName } from "@rag-study/contracts";
import type { TenantRole } from "../../application/ports/tenant-membership-repository.js";
import type { McpOAuthRepository, McpPrincipal, OAuthClient, OAuthRequest, OAuthTokenPair } from "../../application/mcp/remote-types.js";
import { OAuthRequestError } from "../../application/mcp/oauth.js";

const requestColumns = `r.id,r.client_id AS "clientId",r.redirect_uri AS "redirectUri",r.state,r.challenge,r.resource,r.expires_at AS "expiresAt"`;
const clientColumns = `id,name,redirect_uris AS "redirectUris",expires_at AS "expiresAt"`;
type RequestRow = OAuthRequest & { status: string; tenant_id: string; user_id: string; allowed_tools: McpReadToolName[];
  grant_id: string | null; code_expires_at: Date };

export class PgMcpOAuthRepository implements McpOAuthRepository {
  constructor(private readonly pool: Pool) {}
  register(input: { id: string; name: string; redirectUris: string[] }) {
    return this.transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('mcp-oauth-registration',0))");
      await db.query("DELETE FROM mcp_oauth_clients WHERE expires_at<clock_timestamp()");
      const count = await db.query<{ count: string }>("SELECT count(*) FROM mcp_oauth_clients");
      if (Number(count.rows[0]!.count) >= 1000) throw new OAuthRequestError("temporarily_unavailable", "Client registration is at capacity.",429);
      const result = await db.query<OAuthClient>(`INSERT INTO mcp_oauth_clients(id,name,redirect_uris) VALUES($1,$2,$3::jsonb) RETURNING ${clientColumns}`,
        [input.id,input.name,JSON.stringify(input.redirectUris)]);
      return result.rows[0]!;
    });
  }
  async client(id: string) {
    const { rows } = await this.pool.query<OAuthClient>(`SELECT ${clientColumns} FROM mcp_oauth_clients WHERE id=$1 AND expires_at>clock_timestamp()`,[id]);
    return rows[0] ?? null;
  }
  request(input: Omit<OAuthRequest,"id"|"expiresAt">) {
    return this.transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('mcp-oauth-request:'||$1::text,0))",[input.clientId]);
      await db.query("DELETE FROM mcp_oauth_requests WHERE client_id=$1 AND (expires_at<clock_timestamp()-interval '1 day' OR (status='pending' AND expires_at<clock_timestamp()))",[input.clientId]);
      const count=await db.query<{ count: string }>("SELECT count(*) FROM mcp_oauth_requests WHERE client_id=$1 AND status='pending' AND expires_at>clock_timestamp()",[input.clientId]);
      if (Number(count.rows[0]!.count)>=20) throw new OAuthRequestError("temporarily_unavailable","Too many pending authorization requests.",429);
      const { rows }=await db.query<OAuthRequest>(`INSERT INTO mcp_oauth_requests AS r(client_id,redirect_uri,state,challenge,resource)
        SELECT $1,$2,$3,$4,$5 FROM mcp_oauth_clients WHERE id=$1 AND expires_at>clock_timestamp()
        RETURNING ${requestColumns}`,[input.clientId,input.redirectUri,input.state,input.challenge,input.resource]);
      if (!rows[0]) throw new OAuthRequestError("invalid_client","The client registration expired.",401);
      return rows[0];
    });
  }
  async details(id: string) {
    const { rows }=await this.pool.query<OAuthRequest & { clientName: string }>(`SELECT ${requestColumns},c.name AS "clientName" FROM mcp_oauth_requests r
      JOIN mcp_oauth_clients c ON c.id=r.client_id WHERE r.id=$1 AND r.status='pending' AND r.expires_at>clock_timestamp() AND c.expires_at>clock_timestamp()`,[id]);
    return rows[0] ?? null;
  }
  approve(input: Parameters<McpOAuthRepository["approve"]>[0]) {
    return this.transaction(async (db) => {
      const member=await db.query<{ role: TenantRole }>("SELECT role FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 FOR SHARE",[input.tenantId,input.userId]);
      const role=member.rows[0]?.role;
      if (!role || input.tools.length<1 || input.tools.length>5 || new Set(input.tools).size!==input.tools.length ||
        input.tools.some((tool) => !mcpReadToolNames.includes(tool) || (tool==='get_quality_report' && role!=='owner'))) return null;
      const { rows }=await db.query<OAuthRequest>(`UPDATE mcp_oauth_requests r SET status='approved',tenant_id=$2,user_id=$3,allowed_tools=$4,
        code_digest=$5,code_expires_at=least(r.expires_at,clock_timestamp()+interval '60 seconds')
        FROM mcp_oauth_clients c WHERE r.id=$1 AND r.status='pending' AND r.expires_at>clock_timestamp()
          AND c.id=r.client_id AND c.expires_at>clock_timestamp() RETURNING ${requestColumns}`,
      [input.id,input.tenantId,input.userId,input.tools,input.codeDigest]);
      return rows[0] ?? null;
    });
  }
  async deny(id: string) {
    const { rows }=await this.pool.query<OAuthRequest>(`UPDATE mcp_oauth_requests r SET status='denied'
      WHERE r.id=$1 AND r.status='pending' AND r.expires_at>clock_timestamp() RETURNING ${requestColumns}`,[id]);
    return rows[0] ?? null;
  }
  exchangeCode(input: Parameters<McpOAuthRepository["exchangeCode"]>[0]) {
    return this.transaction(async (db) => {
      const result=await db.query<RequestRow>(`SELECT ${requestColumns},r.status,r.tenant_id,r.user_id,r.allowed_tools,r.grant_id,r.code_expires_at
        FROM mcp_oauth_requests r JOIN mcp_oauth_clients c ON c.id=r.client_id
        WHERE r.code_digest=$1 AND r.client_id=$2 AND r.redirect_uri=$3 AND r.resource=$4 AND c.expires_at>clock_timestamp() FOR UPDATE OF r`,
      [input.digest,input.clientId,input.redirectUri,input.resource]);
      const request=result.rows[0];
      if (!request) return false;
      const challenge=createHash('sha256').update(input.verifier).digest('base64url');
      if (challenge.length!==request.challenge.length || !timingSafeEqual(Buffer.from(challenge),Buffer.from(request.challenge))) return false;
      if (request.status==='consumed') { if (request.grant_id) await db.query("UPDATE mcp_oauth_grants SET revoked_at=clock_timestamp() WHERE id=$1",[request.grant_id]); return false; }
      if (request.status!=='approved' || request.code_expires_at.getTime()<=Date.now()) return false;
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('mcp-grants:'||$1::text||':'||$2::text,0))",[request.tenant_id,request.user_id]);
      const capacity=await db.query<{ total: number; client: number }>(`SELECT count(*)::int AS total,count(*) FILTER(WHERE client_id=$3)::int AS client
        FROM mcp_oauth_grants WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()`,[request.tenant_id,request.user_id,input.clientId]);
      if (capacity.rows[0]!.total>=25 || capacity.rows[0]!.client>=5) return false;
      const membership=await db.query<{ role: TenantRole }>("SELECT role FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 FOR SHARE",[request.tenant_id,request.user_id]);
      const role=membership.rows[0]?.role;
      if (!role || (request.allowed_tools.includes('get_quality_report') && role!=='owner')) return false;
      const grant=await db.query<{ id: string; expires_at: Date }>(`INSERT INTO mcp_oauth_grants(tenant_id,user_id,client_id,resource,allowed_tools,expires_at)
        SELECT $1,$2,$3,$4,$5,least(c.expires_at,clock_timestamp()+interval '30 days') FROM mcp_oauth_clients c WHERE c.id=$3
        RETURNING id,expires_at`,[request.tenant_id,request.user_id,input.clientId,input.resource,request.allowed_tools]);
      const current=grant.rows[0]!;
      await db.query("UPDATE mcp_oauth_requests SET status='consumed',grant_id=$2 WHERE id=$1",[request.id,current.id]);
      await this.insertTokens(db,current.id,current.expires_at,input.tokens);
      return true;
    });
  }
  refresh(input: Parameters<McpOAuthRepository["refresh"]>[0]) {
    return this.transaction(async (db) => {
      const { rows }=await db.query<{ grant_id: string; used_at: Date | null; valid: boolean; expires_at: Date; refresh_calls: number; new_window: boolean }>(
        `SELECT g.id AS grant_id,t.used_at,(t.expires_at>clock_timestamp() AND g.expires_at>clock_timestamp()+interval '10 minutes'
            AND g.revoked_at IS NULL AND c.expires_at>clock_timestamp()) AS valid,g.expires_at,
          g.refresh_calls,g.refresh_window<clock_timestamp()-interval '1 day' AS new_window
         FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.id=t.grant_id JOIN mcp_oauth_clients c ON c.id=g.client_id
         JOIN tenant_memberships m ON m.tenant_id=g.tenant_id AND m.user_id=g.user_id
         WHERE t.digest=$1 AND t.kind='refresh' AND g.client_id=$2 AND g.resource=$3 FOR UPDATE OF g,t`,
      [input.digest,input.clientId,input.resource]);
      const token=rows[0];
      if (!token) return false;
      if (token.used_at) { await db.query("UPDATE mcp_oauth_grants SET revoked_at=clock_timestamp() WHERE id=$1",[token.grant_id]); return false; }
      if (!token.valid || (!token.new_window && token.refresh_calls>=288)) return false;
      await db.query("UPDATE mcp_oauth_tokens SET used_at=clock_timestamp() WHERE digest=$1",[input.digest]);
      await db.query(`UPDATE mcp_oauth_grants SET refresh_calls=CASE WHEN $2 THEN 1 ELSE refresh_calls+1 END,
        refresh_window=CASE WHEN $2 THEN clock_timestamp() ELSE refresh_window END WHERE id=$1`,[token.grant_id,token.new_window]);
      await this.insertTokens(db,token.grant_id,token.expires_at,input.tokens);
      return true;
    });
  }
  async verify(digest: Buffer, resource: string): Promise<McpPrincipal | null> {
    const { rows }=await this.pool.query<McpPrincipal>(`SELECT g.id AS "grantId",g.tenant_id AS "tenantId",g.user_id AS "userId",g.client_id AS "clientId",
      g.allowed_tools AS "allowedTools",m.role,least(t.expires_at,g.expires_at,c.expires_at) AS "expiresAt"
      FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.id=t.grant_id JOIN mcp_oauth_clients c ON c.id=g.client_id
      JOIN tenant_memberships m ON m.tenant_id=g.tenant_id AND m.user_id=g.user_id
      WHERE t.digest=$1 AND t.kind='access' AND t.used_at IS NULL AND t.expires_at>clock_timestamp()
        AND g.resource=$2 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND c.expires_at>clock_timestamp()`,[digest,resource]);
    return rows[0] ?? null;
  }
  async revokeToken(digest: Buffer, clientId?: string) {
    await this.pool.query(`UPDATE mcp_oauth_grants g SET revoked_at=clock_timestamp()
      FROM mcp_oauth_tokens t WHERE t.digest=$1 AND t.grant_id=g.id AND ($2::text IS NULL OR g.client_id=$2)`,[digest,clientId??null]);
  }
  async grants(userId: string, tenantId: string) {
    const { rows }=await this.pool.query<import('../../application/mcp/remote-types.js').OAuthGrant>(`SELECT g.id,g.tenant_id AS "tenantId",g.user_id AS "userId",g.client_id AS "clientId",
      g.allowed_tools AS "allowedTools",least(g.expires_at,c.expires_at) AS "expiresAt",g.created_at AS "createdAt",c.name AS "clientName"
      FROM mcp_oauth_grants g JOIN mcp_oauth_clients c ON c.id=g.client_id
      JOIN tenant_memberships m ON m.tenant_id=g.tenant_id AND m.user_id=g.user_id
      WHERE g.user_id=$1 AND g.tenant_id=$2 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND c.expires_at>clock_timestamp()
      ORDER BY g.created_at DESC LIMIT 100`,[userId,tenantId]);
    return rows;
  }
  async revokeGrant(userId: string, tenantId: string, grantId: string) {
    const { rowCount }=await this.pool.query("UPDATE mcp_oauth_grants SET revoked_at=clock_timestamp() WHERE user_id=$1 AND tenant_id=$2 AND id=$3",[userId,tenantId,grantId]);
    return Boolean(rowCount);
  }
  private async insertTokens(db: PoolClient, grantId: string, expiresAt: Date, tokens: OAuthTokenPair) {
    await db.query(`INSERT INTO mcp_oauth_tokens(digest,grant_id,kind,expires_at) VALUES
      ($1,$3,'access',least($4,$6::timestamptz,clock_timestamp()+interval '10 minutes')),
      ($2,$3,'refresh',least($5,$6::timestamptz,clock_timestamp()+interval '7 days'))`,
    [tokens.accessDigest,tokens.refreshDigest,grantId,tokens.accessExpiresAt,tokens.refreshExpiresAt,expiresAt]);
  }
  private async transaction<T>(action: (db: PoolClient) => Promise<T>): Promise<T> {
    const db=await this.pool.connect();
    try { await db.query('BEGIN'); await db.query("SET LOCAL statement_timeout='3s'"); const value=await action(db); await db.query('COMMIT'); return value; }
    catch(error) { await db.query('ROLLBACK').catch(()=>{}); throw error; } finally { db.release(); }
  }
}
