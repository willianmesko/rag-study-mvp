import {WorkflowGuardError} from '../../../../platform/workflows/types.js';
import {retryDelayMs} from '../../../../platform/integrations/retry-policy.js';
import type { DocumentTextExtractor } from "../ports/document-text-extractor.js";
import { publicExtractionFailure } from "../ports/document-text-extractor.js";
import type { IngestionJobRepository } from "../ports/ingestion-job-repository.js";
import type { OriginalFileStore } from "../../../knowledge/index.js";
import type { IngestDocumentUseCase } from "./ingest-document.js";
import type { SemanticAnswerCache } from "../../../chat/index.js";

export class ProcessNextIngestionJobUseCase {
  constructor(private readonly jobs: Pick<IngestionJobRepository, "claimNext" | "recordEvent" | "complete" | "fail" | "deferAdmission">, private readonly extractor: DocumentTextExtractor, private readonly ingest: Pick<IngestDocumentUseCase, "execute">, private readonly originals: Pick<OriginalFileStore, "get">, private readonly cache?: SemanticAnswerCache,private readonly enqueueWorkflow?:(job:import('../ports/ingestion-job-repository.js').IngestionJob)=>Promise<void>) {}

  async execute(signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    const job = await this.jobs.claimNext();
    if (!job) return false;
    if (signal?.aborted) {
      if (this.jobs.deferAdmission) await this.jobs.deferAdmission(job.id, "processing_interrupted", 1_000);
      else await this.jobs.fail(job.id, "Processing was interrupted. Retry this document.");
      signal.throwIfAborted();
    }
    if (this.enqueueWorkflow) {
      try { await this.enqueueWorkflow(job); }
      catch (error) {
        // An interrupted enqueue can have committed. Preserve its durable ID
        // and let lease/admission reconciliation decide the saved outcome.
        if (signal?.aborted) throw signal.reason;
        const permanent=error instanceof WorkflowGuardError&&error.code!=='queue_full';
        if(!permanent&&this.jobs.deferAdmission)await this.jobs.deferAdmission(job.id,'workflow_admission_retry',retryDelayMs(job.admissionAttempts??1,{baseMs:1000}));
        else await this.jobs.fail(job.id,'workflow_admission_failed');
      }
      return true;
    }
    let completed = false;
    try {
      signal?.throwIfAborted();
      await this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, stage: "processing", status: "started" });
      const sourceReadStartedAt = Date.now();
      await this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, stage: "source_read", status: "started" });
      const payload = job.payload ?? await this.readStoredOriginal(job.storagePath, signal);
      signal?.throwIfAborted();
      await this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, stage: "source_read", status: "completed", durationMs: Date.now() - sourceReadStartedAt, details: { bytes: payload.byteLength } });
      const extractionStartedAt = Date.now();
      await this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, stage: "text_extraction", status: "started" });
      const extracted = await this.extractor.extract(
        { filename: job.filename, mimeType: job.mimeType, payload },
        (event) => this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, ...event }), signal
      ).catch(async (error: unknown) => {
        if (signal?.aborted) throw signal.reason;
        await this.jobs.recordEvent({
          jobId: job.id, tenantId: job.tenantId, stage: "text_extraction", status: "failed",
          durationMs: Date.now() - extractionStartedAt
        });
        throw error;
      });
      signal?.throwIfAborted();
      const { format, language, sectionCount } = extracted.metadata;
      await this.jobs.recordEvent({
        jobId: job.id, tenantId: job.tenantId, stage: "text_extraction", status: "completed",
        durationMs: Date.now() - extractionStartedAt,
        details: { characters: extracted.text.length, format, language, sectionCount }
      });
      const result = await this.ingest.execute(
        {
          tenantId: job.tenantId, source: job.source, title: job.title ?? extracted.title, text: extracted.text, sections: extracted.sections,
          metadata: { ...extracted.metadata, filename: job.filename, mimeType: job.mimeType, ingestionJobId: job.id }
        },
        (event) => this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, ...event }), signal
      );
      signal?.throwIfAborted();
      await this.jobs.complete(job.id, { documentId: result.id, ...result });
      completed = true;
      await this.cache?.invalidateTenant(job.tenantId);
      await this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, stage: "completed", status: "completed", details: { documentId: result.id, chunkCount: result.chunkCount, highRiskChunks: result.highRiskChunks } });
    } catch (error) {
      // A late cleanup/reporting failure cannot undo acknowledged completion.
      // Keep the failure visible to the worker without publishing a failed job.
      if (completed) throw error;
      const interrupted = Boolean(signal?.aborted);
      const message = interrupted ? "Processing was interrupted. Review before retrying this document." : publicExtractionFailure(error) ?? "The document could not be processed. Review its processing steps.";
      await this.jobs.fail(job.id, message);
      await this.jobs.recordEvent({ jobId: job.id, tenantId: job.tenantId, stage: interrupted ? "interrupted" : "failed", status: interrupted ? "info" : "failed", details: { code: interrupted ? "processing_interrupted" : "processing_failed" } });
      if (signal?.aborted) throw signal.reason;
    }
    return true;
  }

  private async readStoredOriginal(storagePath: string | null, signal?: AbortSignal): Promise<Buffer> {
    if (!storagePath) throw new Error("The ingestion job has no readable original file.");
    return this.originals.get(storagePath, signal);
  }
}
