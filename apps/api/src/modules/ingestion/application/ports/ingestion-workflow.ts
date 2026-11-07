import type { IngestionJob } from "./ingestion-job-repository.js";

export type IngestionWorkflowOptions = {
  chunkSize: number;
  chunkOverlap: number;
  ocrEnabled: boolean;
  ocrLanguages: string;
  ocrMaxPages: number;
  ocrTimeoutMs: number;
  maxCostUsd: number;
};

export interface IngestionWorkflow {
  readonly version: string;
  execute(job: IngestionJob, signal: AbortSignal): Promise<{
    id: string;
    chunkCount: number;
    highRiskChunks: number;
  }>;
}
