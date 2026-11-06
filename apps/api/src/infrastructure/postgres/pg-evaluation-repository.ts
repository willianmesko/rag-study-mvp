import type { Pool } from "pg";
import type { CreateEvaluationRun, EvaluationRepository, EvaluationRun } from "../../application/ports/evaluation-repository.js";

type Row = {
  id: string;
  tenant_id: string;
  dataset_name: string;
  dataset_version: string;
  commit_sha: string | null;
  embedding_provider: string;
  embedding_model: string;
  chat_provider: string;
  chat_model: string;
  total_cases: number;
  hit_rate: string | number;
  mean_reciprocal_rank: string | number;
  faithfulness: string | number | null;
  context_precision: string | number | null;
  injection_pass_rate: string | number;
  passed: boolean;
  duration_ms: number;
  failure_details: Record<string, unknown>;
  created_at: Date;
};

const columns = "id, tenant_id, dataset_name, dataset_version, commit_sha, embedding_provider, embedding_model, chat_provider, chat_model, total_cases, hit_rate, mean_reciprocal_rank, faithfulness, context_precision, injection_pass_rate, passed, duration_ms, failure_details, created_at";

function map(row: Row): EvaluationRun {
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
    totalCases: Number(row.total_cases),
    hitRate: Number(row.hit_rate),
    meanReciprocalRank: Number(row.mean_reciprocal_rank),
    faithfulness: row.faithfulness === null ? null : Number(row.faithfulness),
    contextPrecision: row.context_precision === null ? null : Number(row.context_precision),
    injectionPassRate: Number(row.injection_pass_rate),
    passed: row.passed,
    durationMs: Number(row.duration_ms),
    failureDetails: row.failure_details ?? {},
    createdAt: row.created_at
  };
}

export class PgEvaluationRepository implements EvaluationRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateEvaluationRun): Promise<EvaluationRun> {
    const result = await this.pool.query<Row>(
      `INSERT INTO evaluation_runs (
        tenant_id, dataset_name, dataset_version, commit_sha, embedding_provider,
        embedding_model, chat_provider, chat_model, total_cases, hit_rate,
        mean_reciprocal_rank, faithfulness, context_precision, injection_pass_rate,
        passed, duration_ms, failure_details
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
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
        JSON.stringify(input.failureDetails)
      ]
    );
    return map(result.rows[0] as Row);
  }

  async list(tenantId: string, limit: number): Promise<EvaluationRun[]> {
    const result = await this.pool.query<Row>(
      `SELECT ${columns} FROM evaluation_runs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [tenantId, limit]
    );
    return result.rows.map(map);
  }
}
