import type { Pool } from "pg";
import type { DemoSourceState } from "@rag-study/contracts";
import type { DemoLibraryRepository } from "../../application/ports/demo-library-repository.js";

export class PgDemoLibraryRepository implements DemoLibraryRepository {
  constructor(private readonly pool: Pool) {}

  async sourceStates(tenantId: string, sources: readonly string[]): Promise<DemoSourceState[]> {
    if (sources.length > 20) throw new Error("Demo source lookup exceeds its limit.");
    const result = await this.pool.query<{ source: string; state: DemoSourceState["state"]; document_id: string | null; job_id: string | null }>(
      `SELECT s.source, CASE WHEN d.id IS NOT NULL THEN 'ready' ELSE COALESCE(j.status, 'missing') END AS state,
              d.id AS document_id, j.id AS job_id
       FROM unnest($2::text[]) AS s(source)
       LEFT JOIN documents d ON d.tenant_id=$1 AND d.source=s.source
       LEFT JOIN LATERAL (
         SELECT id, status FROM ingestion_jobs
         WHERE tenant_id=$1 AND source=s.source AND status IN ('queued','processing','failed')
         ORDER BY created_at DESC, id DESC LIMIT 1
       ) j ON TRUE`, [tenantId, sources]);
    return result.rows.map((row) => ({ source: row.source, state: row.state, documentId: row.document_id, jobId: row.job_id }));
  }
}
