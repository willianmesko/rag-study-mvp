import type { PromptInjectionAssessment } from "../../domain/security/prompt-injection.js";

export class ExistingIngestionSourceError extends Error {
  constructor(readonly source: string, readonly state: "ready" | "queued" | "processing", readonly documentId: string | null, readonly jobId: string | null) {
    super("This source is already available or being prepared.");
    this.name = "ExistingIngestionSourceError";
  }
}
export class UploadAdmissionError extends Error {
  constructor(readonly code:'idempotency_conflict'|'upload_quota_exceeded') {
    super(code==='idempotency_conflict'?'This upload key belongs to a different document.':'Daily upload quota reached. Try again tomorrow.');
    this.name='UploadAdmissionError';
  }
}
export type UploadAdmission={keyHash:string;requestHash:string;quota?:{actorKey:string;bytes:number;limit:number}};
export type EnqueueOptions={onlyIfMissing?:true;admission?:UploadAdmission};

export type IngestionJobStatus = "queued" | "processing" | "completed" | "failed";
export type IngestionEventStatus = "started" | "completed" | "failed" | "info";

export type IngestionJobEvent = {
  id: string;
  jobId: string;
  stage: string;
  status: IngestionEventStatus;
  durationMs: number | null;
  details: Record<string, unknown>;
  createdAt: Date;
};

export type IngestionJob = {
  admissionAttempts?:number;
  id: string;
  tenantId: string;
  documentId: string | null;
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

export type IndexedOriginal = Pick<IngestionJob, "filename" | "mimeType" | "payload" | "storagePath">;

export type IngestionPassagePreview = {
  totalChunks: number;
  passages: Array<{ chunkId: string; ordinal: number; content: string; security: PromptInjectionAssessment }>;
};

export interface IngestionJobRepository {
  enqueue(input: Omit<IngestionJob, "id" | "documentId" | "status" | "progress" | "error" | "chunkCount" | "highRiskChunks" | "createdAt" | "updatedAt">, options?: EnqueueOptions): Promise<IngestionJob>;
  findIdempotent?(tenantId:string,admission:Pick<UploadAdmission,'keyHash'|'requestHash'>):Promise<IngestionJob|null>;
  usesStoragePath?(tenantId:string,path:string):Promise<boolean>;
  deferAdmission?(id:string,reason:string,delayMs:number):Promise<boolean>;
  claimNext(): Promise<IngestionJob | null>;
  readForProcessing?(jobId:string,tenantId:string):Promise<IngestionJob|null>;
  complete(id: string, result: { documentId: string; chunkCount: number; highRiskChunks: number }): Promise<void>;
  fail(id: string, error: string): Promise<void>;
  retry(id: string, tenantId: string): Promise<boolean>;
  list(tenantId: string, limit: number): Promise<Omit<IngestionJob, "payload">[]>;
  previewPassages(input: { jobId: string; tenantId: string }): Promise<IngestionPassagePreview | null>;
  findIndexedOriginal(input: { documentId: string; tenantId: string }): Promise<IndexedOriginal | null>;
  requeueDocument(documentId: string, tenantId: string): Promise<IngestionJob | null>;
  listStoragePathsForDocument(documentId: string, tenantId: string): Promise<string[]>;
  deleteForDocument(documentId: string, tenantId: string): Promise<void>;
  recordEvent(input: {
    jobId: string;
    tenantId: string;
    stage: string;
    status: IngestionEventStatus;
    durationMs?: number | null;
    details?: Record<string, unknown>;
  }): Promise<void>;
  listEvents(jobId: string, tenantId: string, limit: number): Promise<IngestionJobEvent[]>;
}
