import type { Pool } from "pg";
import { knowledgeStatusSchema } from "@rag-study/contracts";
import type { KnowledgeStatusRepository } from "../../application/ports/knowledge-status-repository.js";

export class PgKnowledgeStatusRepository implements KnowledgeStatusRepository {
  constructor(private readonly pool: Pool) {}

  async get(tenantId: string) {
    // One snapshot: an empty document row is not searchable knowledge. Count
    // the actual index, including CLI ingestion, rather than the latest jobs.
    const result = await this.pool.query<{
      indexed_documents: string; passages: string; processing_jobs: string; failed_jobs: string;
    }>(`SELECT
      (SELECT count(*) FROM documents d WHERE d.tenant_id = $1
        AND EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = d.id)) AS indexed_documents,
      (SELECT count(*) FROM chunks c JOIN documents d ON d.id = c.document_id
        WHERE d.tenant_id = $1) AS passages,
      count(*) FILTER (WHERE j.status IN ('queued', 'processing')) AS processing_jobs,
      count(*) FILTER (WHERE j.status = 'failed') AS failed_jobs
      FROM ingestion_jobs j WHERE j.tenant_id = $1`, [tenantId]);
    const row = result.rows[0]!;
    return knowledgeStatusSchema.parse({
      indexedDocuments: Number(row.indexed_documents), passages: Number(row.passages),
      processingJobs: Number(row.processing_jobs), failedJobs: Number(row.failed_jobs)
    });
  }
}
