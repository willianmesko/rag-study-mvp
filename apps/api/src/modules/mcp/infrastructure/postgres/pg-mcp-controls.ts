import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type { McpProviderBudget } from "../../application/hybrid-search.js";
import type { McpCallControls, McpPrincipal } from "../../application/remote-types.js";
import { postgresDeadlineProfiles, withPostgresTransaction } from "../../../../platform/database/sql-boundary.js";

export type McpControlLimits = {
  callsPerMinute: number; callsPerDay: number; providerCallsPerDay: number;
  inputTokensPerDay: number; userCostNanoUsdPerDay: number; tenantCostNanoUsdPerDay: number; concurrentProviders: number;
};
export class PgMcpControls implements McpProviderBudget, McpCallControls {
  constructor(private readonly pool: Pool, private readonly limits: McpControlLimits) {}
  async admit(tenantId: string, userId: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const { rows } = await this.transaction((client) => client.query<{ allowed: boolean }>(
      `INSERT INTO workspace_mcp_call_usage(tenant_id,user_id,usage_day,calls,window_started_at,window_calls)
       SELECT $1,$2,(clock_timestamp() AT TIME ZONE 'UTC')::date,1,clock_timestamp(),1
       FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2
       ON CONFLICT(tenant_id,user_id,usage_day) DO UPDATE SET
         calls=least(workspace_mcp_call_usage.calls+1,$4::int+1),
         window_calls=CASE WHEN workspace_mcp_call_usage.window_started_at < statement_timestamp()-interval '1 minute'
           THEN 1 ELSE least(workspace_mcp_call_usage.window_calls+1,$3::int+1) END,
         window_started_at=CASE WHEN workspace_mcp_call_usage.window_started_at < statement_timestamp()-interval '1 minute'
           THEN statement_timestamp() ELSE workspace_mcp_call_usage.window_started_at END
       RETURNING calls<=$4::int AND window_calls<=$3::int AS allowed`, [tenantId,userId,this.limits.callsPerMinute,this.limits.callsPerDay]), signal);
    signal.throwIfAborted();
    return rows[0]?.allowed ?? false;
  }
  async reserve(input: Parameters<McpProviderBudget["reserve"]>[0]): Promise<string | null> {
    input.signal.throwIfAborted();
    if (!Number.isSafeInteger(input.inputTokens) || input.inputTokens < 1 || input.inputTokens > 2048 || !Number.isSafeInteger(input.costNanoUsd) || input.costNanoUsd < 0)
      throw new Error("Invalid MCP provider reservation.");
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mcp-provider:'||$1::text,0))",[input.tenantId]);
      input.signal.throwIfAborted();
      const member = await client.query("SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 FOR KEY SHARE",[input.tenantId,input.userId]);
      if (!member.rowCount) return null;
      await client.query("DELETE FROM workspace_mcp_provider_reservations WHERE tenant_id=$1 AND expires_at < clock_timestamp()-interval '1 hour'",[input.tenantId]);
      const { rows: [totals] } = await client.query<{ user_calls: number; user_tokens: string; user_cost: string; tenant_cost: string; active: string }>(
        `SELECT coalesce(sum(calls) FILTER(WHERE user_id=$2),0)::int AS user_calls,
          coalesce(sum(input_tokens) FILTER(WHERE user_id=$2),0) AS user_tokens,
          coalesce(sum(cost_nano_usd) FILTER(WHERE user_id=$2),0) AS user_cost,
          coalesce(sum(cost_nano_usd),0) AS tenant_cost,
          (SELECT count(*) FROM workspace_mcp_provider_reservations WHERE tenant_id=$1 AND finished_at IS NULL AND expires_at>clock_timestamp()) AS active
         FROM workspace_mcp_provider_usage WHERE tenant_id=$1 AND usage_day=(clock_timestamp() AT TIME ZONE 'UTC')::date`, [input.tenantId,input.userId]);
      if (!totals || totals.user_calls >= this.limits.providerCallsPerDay || Number(totals.user_tokens)+input.inputTokens > this.limits.inputTokensPerDay ||
        Number(totals.user_cost)+input.costNanoUsd > this.limits.userCostNanoUsdPerDay || Number(totals.tenant_cost)+input.costNanoUsd > this.limits.tenantCostNanoUsdPerDay ||
        Number(totals.active) >= this.limits.concurrentProviders) return null;
      input.signal.throwIfAborted();
      await client.query(`INSERT INTO workspace_mcp_provider_usage(tenant_id,user_id,usage_day,calls,input_tokens,cost_nano_usd)
        VALUES($1,$2,(clock_timestamp() AT TIME ZONE 'UTC')::date,1,$3,$4)
        ON CONFLICT(tenant_id,user_id,usage_day) DO UPDATE SET calls=workspace_mcp_provider_usage.calls+1,
          input_tokens=workspace_mcp_provider_usage.input_tokens+EXCLUDED.input_tokens,cost_nano_usd=workspace_mcp_provider_usage.cost_nano_usd+EXCLUDED.cost_nano_usd`,
      [input.tenantId,input.userId,input.inputTokens,input.costNanoUsd]);
      const result = await client.query<{ id: string }>(`INSERT INTO workspace_mcp_provider_reservations(tenant_id,user_id,input_tokens,cost_nano_usd)
        VALUES($1,$2,$3,$4) RETURNING id`,[input.tenantId,input.userId,input.inputTokens,input.costNanoUsd]);
      return result.rows[0]!.id;
    }, input.signal);
  }
  async finishReservation(id: string): Promise<void> {
    await this.pool.query("UPDATE workspace_mcp_provider_reservations SET finished_at=clock_timestamp() WHERE id=$1 AND finished_at IS NULL",[id]);
  }
  async finish(id: string): Promise<void> {
    await this.pool.query("UPDATE workspace_mcp_executions SET state='finished' WHERE id=$1",[id]);
  }
  async begin(input: { principal: McpPrincipal; requestKey: string; tool: Parameters<McpCallControls["begin"]>[0]["tool"]; timeoutMs: number }): Promise<string | null> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO workspace_mcp_executions(id,grant_id,request_key,tool,expires_at)
       VALUES($1,$2,$3,$4,least(clock_timestamp()+$5::int*interval '1 millisecond',$6::timestamptz))
       ON CONFLICT(grant_id,request_key) DO UPDATE SET id=EXCLUDED.id,tool=EXCLUDED.tool,state='running',expires_at=EXCLUDED.expires_at
         WHERE workspace_mcp_executions.state='finished' OR workspace_mcp_executions.expires_at<clock_timestamp()
       RETURNING id`, [randomUUID(),input.principal.grantId,input.requestKey,input.tool,input.timeoutMs,input.principal.expiresAt]);
    return rows[0]?.id ?? null;
  }
  async alive(id: string) {
    const { rowCount } = await this.pool.query(`SELECT 1 FROM workspace_mcp_executions e JOIN mcp_oauth_grants g ON g.id=e.grant_id
      JOIN mcp_oauth_clients c ON c.id=g.client_id JOIN tenant_memberships m ON m.tenant_id=g.tenant_id AND m.user_id=g.user_id
      WHERE e.id=$1 AND e.state='running' AND e.expires_at>clock_timestamp() AND g.revoked_at IS NULL
        AND g.expires_at>clock_timestamp() AND c.expires_at>clock_timestamp() AND e.tool=ANY(g.allowed_tools)
        AND (e.tool<>'get_quality_report' OR m.role='owner')`,[id]);
    return Boolean(rowCount);
  }
  async cancel(principal: McpPrincipal, requestKey: string) {
    await this.pool.query("UPDATE workspace_mcp_executions SET state='cancel_requested' WHERE grant_id=$1 AND request_key=$2 AND state='running'",
      [principal.grantId,requestKey]);
  }
  private transaction<T>(action: (client: PoolClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return withPostgresTransaction(this.pool, action, {
      signal,
      limits: { ...postgresDeadlineProfiles.runtime, statementMs: 3_000 },
    });
  }
}
