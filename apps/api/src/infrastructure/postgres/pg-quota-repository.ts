import type { Pool } from "pg";
import type { QuotaRepository, QuotaResult } from "../../application/ports/quota-repository.js";

type UsageRow = { qa_requests: number; uploaded_bytes: string | number };

export class PgQuotaRepository implements QuotaRepository {
  constructor(private readonly pool: Pool) {}

  async consumeQuestion(input: Parameters<QuotaRepository["consumeQuestion"]>[0]): Promise<QuotaResult> {
    const units = input.units ?? 1;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tenant = await client.query<UsageRow>(
        `INSERT INTO tenant_daily_usage (tenant_id, actor_key, qa_requests)
         SELECT $1, '__tenant__', $2::INTEGER WHERE $2::INTEGER <= $3
         ON CONFLICT (tenant_id, actor_key, usage_date) DO UPDATE
         SET qa_requests = tenant_daily_usage.qa_requests + EXCLUDED.qa_requests, updated_at = NOW()
         WHERE tenant_daily_usage.qa_requests + EXCLUDED.qa_requests <= $3 RETURNING qa_requests, uploaded_bytes`,
        [input.tenantId, units, input.tenantLimit]
      );
      if (tenant.rowCount !== 1) { await client.query("ROLLBACK"); return { allowed: false, used: null, limit: input.tenantLimit }; }
      const actor = await client.query<UsageRow>(
        `INSERT INTO tenant_daily_usage (tenant_id, actor_key, qa_requests)
         SELECT $1, $2, $3::INTEGER WHERE $3::INTEGER <= $4
         ON CONFLICT (tenant_id, actor_key, usage_date) DO UPDATE
         SET qa_requests = tenant_daily_usage.qa_requests + EXCLUDED.qa_requests, updated_at = NOW()
         WHERE tenant_daily_usage.qa_requests + EXCLUDED.qa_requests <= $4 RETURNING qa_requests, uploaded_bytes`,
        [input.tenantId, input.actorKey, units, input.actorLimit]
      );
      if (actor.rowCount !== 1) { await client.query("ROLLBACK"); return { allowed: false, used: null, limit: input.actorLimit }; }
      await client.query("COMMIT");
      return { allowed: true, used: actor.rows[0]?.qa_requests ?? null, limit: input.actorLimit };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async consumeUpload(input: { tenantId: string; actorKey: string; bytes: number; limit: number }): Promise<QuotaResult> {
    const result = await this.pool.query<UsageRow>(
      `INSERT INTO tenant_daily_usage (tenant_id, actor_key, uploaded_bytes)
       SELECT $1, $2, $3::BIGINT WHERE $3::BIGINT <= $4::BIGINT
       ON CONFLICT (tenant_id, actor_key, usage_date) DO UPDATE
         SET uploaded_bytes = tenant_daily_usage.uploaded_bytes + EXCLUDED.uploaded_bytes, updated_at = NOW()
         WHERE tenant_daily_usage.uploaded_bytes + EXCLUDED.uploaded_bytes <= $4::BIGINT
       RETURNING qa_requests, uploaded_bytes`,
      [input.tenantId, input.actorKey, input.bytes, input.limit]
    );
    const used = result.rows[0]?.uploaded_bytes;
    return { allowed: result.rowCount === 1, used: used === undefined ? null : Number(used), limit: input.limit };
  }
}
