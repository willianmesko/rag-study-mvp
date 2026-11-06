export type IngestionJobStatus = "queued" | "processing" | "completed" | "failed";

export type IngestionJob = {
  id: string;
  tenantId: string;
  source: string;
  title: string | null;
  filename: string;
  mimeType: string;
  payload: Buffer | null;
  storagePath: string | null;
  status: IngestionJobStatus;
  progress: number;
  error: string | null;
  chunkCount: number | null;
  highRiskChunks: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface IngestionJobRepository {
  enqueue(input: Omit<IngestionJob, "id" | "status" | "progress" | "error" | "chunkCount" | "highRiskChunks" | "createdAt" | "updatedAt">): Promise<IngestionJob>;
  claimNext(): Promise<IngestionJob | null>;
  complete(id: string, result: { chunkCount: number; highRiskChunks: number }): Promise<void>;
  fail(id: string, error: string): Promise<void>;
  retry(id: string, tenantId: string): Promise<boolean>;
  list(tenantId: string, limit: number): Promise<Omit<IngestionJob, "payload">[]>;
}
