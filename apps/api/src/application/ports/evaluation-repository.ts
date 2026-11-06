export type EvaluationRun = {
  id: string;
  tenantId: string;
  datasetName: string;
  datasetVersion: string;
  commitSha: string | null;
  embeddingProvider: string;
  embeddingModel: string;
  chatProvider: string;
  chatModel: string;
  totalCases: number;
  hitRate: number;
  meanReciprocalRank: number;
  faithfulness: number | null;
  contextPrecision: number | null;
  injectionPassRate: number;
  passed: boolean;
  durationMs: number;
  failureDetails: Record<string, unknown>;
  createdAt: Date;
};

export type CreateEvaluationRun = Omit<EvaluationRun, "id" | "createdAt">;

export interface EvaluationRepository {
  create(input: CreateEvaluationRun): Promise<EvaluationRun>;
  list(tenantId: string, limit: number): Promise<EvaluationRun[]>;
}
