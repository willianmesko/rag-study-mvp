import type { Pool } from "pg";
import type { QuotaRepository, QuotaResult } from "../../application/ports/quota-repository.js";

type UsageRow = { qa_requests: number; uploaded_bytes: string | number };

export class PgQuotaRepository implements QuotaRepository {
  constructor(private readonly pool: Pool) {}

  async consumeQuestion(input: { tenantId: string; actorKey: string; limit: number }): Promise<QuotaResult> {
    const result = await this.pool.query<UsageRow>(
      `INSERT INTO tenant_daily_usage (tenant_id, actor_key, qa_requests)
       VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id, actor_key, usage_date) DO UPDATE
         SET qa_requests = tenant_daily_usage.qa_requests + 1, updated_at = NOW()
         WHERE tenant_daily_usage.qa_requests < $3
       RETURNING qa_requests, uploaded_bytes`,
      [input.tenantId, input.actorKey, input.limit]
    );
    return { allowed: result.rowCount === 1, used: result.rows[0]?.qa_requests ?? null, limit: input.limit };
  }

  async consumeUpload(input: { tenantId: string; actorKey: string; bytes: number; limit: number }): Promise<QuotaResult> {
    const result = await this.pool.query<UsageRow>(
      `INSERT INTO tenant_daily_usage (tenant_id, actor_key, uploaded_bytes)
       SELECT $1, $2, $3 WHERE $3 <= $4
       ON CONFLICT (tenant_id, actor_key, usage_date) DO UPDATE
         SET uploaded_bytes = tenant_daily_usage.uploaded_bytes + EXCLUDED.uploaded_bytes, updated_at = NOW()
         WHERE tenant_daily_usage.uploaded_bytes + EXCLUDED.uploaded_bytes <= $4
       RETURNING qa_requests, uploaded_bytes`,
      [input.tenantId, input.actorKey, input.bytes, input.limit]
    );
    const used = result.rows[0]?.uploaded_bytes;
    return { allowed: result.rowCount === 1, used: used === undefined ? null : Number(used), limit: input.limit };
  }
}
