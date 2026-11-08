import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { decodeStoredRecord, storedRatioSchema as ratio } from "../../../../platform/database/stored-record.js";
import type { CreateEvaluationRun, EvaluationRepository, EvaluationRun } from "../../application/ports/evaluation-repository.js";
import { currentExecution } from '../../../../platform/workflows/execution-context.js';
import { lockWorkflowFence } from '../../../../platform/database/workflow-fence.js';

const evaluationRow = z.object({
  id: z.uuid(), tenant_id: z.uuid(), dataset_name: z.string(), dataset_version: z.string(),
  commit_sha: z.string().nullable(), embedding_provider: z.string(), embedding_model: z.string(),
  chat_provider: z.string(), chat_model: z.string(), total_cases: z.number().int().nonnegative(),
  hit_rate: ratio, mean_reciprocal_rank: ratio, faithfulness: ratio.nullable(), context_precision: ratio.nullable(),
  injection_pass_rate: ratio, passed: z.boolean(), duration_ms: z.number().int().nonnegative(),
  failure_details: z.record(z.string(), z.unknown()), created_at: z.date(),
});

const columns = "id, tenant_id, dataset_name, dataset_version, commit_sha, embedding_provider, embedding_model, chat_provider, chat_model, total_cases, hit_rate, mean_reciprocal_rank, faithfulness, context_precision, injection_pass_rate, passed, duration_ms, failure_details, created_at";

function map(value: unknown): EvaluationRun {
  const row = decodeStoredRecord(evaluationRow, value);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    datasetName: row.dataset_name,
    datasetVersion: row.dataset_version,
    commitSha: row.commit_sha,
    embeddingProvider: row.embedding_provider,
    embeddingModel: row.embedding_model,
    chatProvider: row.chat_provider,
    chatModel: row.chat_model,
    totalCases: row.total_cases,
    hitRate: row.hit_rate,
    meanReciprocalRank: row.mean_reciprocal_rank,
    faithfulness: row.faithfulness,
    contextPrecision: row.context_precision,
    injectionPassRate: row.injection_pass_rate,
    passed: row.passed,
    durationMs: row.duration_ms,
    failureDetails: row.failure_details,
    createdAt: row.created_at
  };
}

export class PgEvaluationRepository implements EvaluationRepository {
  constructor(private readonly pool: Pool | PoolClient) {}

  async create(input: CreateEvaluationRun): Promise<EvaluationRun> {
    const execution=currentExecution();
    const client=execution && !('release' in this.pool) ? await this.pool.connect() : undefined;
    if(execution&&!client)throw new Error('Workflow reports require a transaction-capable connection pool.');
    try {
    if(client){await client.query('BEGIN');await lockWorkflowFence(client,input.tenantId);}
    const result = await (client??this.pool).query<Record<string, unknown>>(
      `INSERT INTO evaluation_runs (
        tenant_id, dataset_name, dataset_version, commit_sha, embedding_provider,
        embedding_model, chat_provider, chat_model, total_cases, hit_rate,
        mean_reciprocal_rank, faithfulness, context_precision, injection_pass_rate,
        passed, duration_ms, failure_details${execution ? ",workflow_run_id" : ""}
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb${execution ? ",$18" : ""})
      ${execution ? "ON CONFLICT(tenant_id,workflow_run_id) WHERE workflow_run_id IS NOT NULL DO UPDATE SET workflow_run_id=EXCLUDED.workflow_run_id" : ""}
      RETURNING ${columns}`,
      [
        input.tenantId,
        input.datasetName,
        input.datasetVersion,
        input.commitSha,
        input.embeddingProvider,
        input.embeddingModel,
        input.chatProvider,
        input.chatModel,
        input.totalCases,
        input.hitRate,
        input.meanReciprocalRank,
        input.faithfulness,
        input.contextPrecision,
        input.injectionPassRate,
        input.passed,
        input.durationMs,
        JSON.stringify(input.failureDetails),...(execution?[execution.lease.kind==='evaluation'?execution.lease.runId:null]:[])
      ]
    );
    const run = map(result.rows[0]);
    if(client)await client.query('COMMIT');
    return run;
    }catch(error){if(client)await client.query('ROLLBACK');throw error;}finally{client?.release();}
  }

  async list(tenantId: string, limit: number): Promise<EvaluationRun[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT ${columns} FROM evaluation_runs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [tenantId, limit]
    );
    return result.rows.map(map);
  }
}
