import { createHash } from "node:crypto";
import { z } from "zod";
import type { config } from "../../config.js";
import type { IngestionJob, IngestionJobRepository } from "./application/ports/ingestion-job-repository.js";
import type { DocumentTextExtractor } from "./application/ports/document-text-extractor.js";
import type { OriginalFileStore } from "../knowledge/index.js";
import type { SemanticAnswerCache } from "../chat/index.js";
import type { IngestDocumentUseCase } from "./application/use-cases/ingest-document.js";
import { WorkflowGuardError, type WorkflowEngine } from "../../platform/workflows/types.js";
import { LangGraphIngestionWorkflow, ingestionWorkflowVersion } from "./infrastructure/langgraph/langgraph-ingestion-workflow.js";

type IngestionWorkflowConfiguration = Pick<typeof config,
  "CHUNK_SIZE" | "CHUNK_OVERLAP" | "PDF_OCR_ENABLED" | "PDF_OCR_LANGUAGES" |
  "PDF_OCR_MAX_PAGES" | "PDF_OCR_TIMEOUT_MS" | "WORKFLOW_INGEST_MAX_COST_USD">;

export function createIngestionWorkflow(dependencies: {
  jobs: IngestionJobRepository & Required<Pick<IngestionJobRepository, "readForProcessing">>;
  extractor: DocumentTextExtractor;
  ingestDocument: IngestDocumentUseCase;
  originals: OriginalFileStore;
  semanticCache: SemanticAnswerCache;
  engine?: Pick<WorkflowEngine, "register" | "submit">;
  embeddingVersion: (tenantId: string) => Promise<string>;
  configuration: IngestionWorkflowConfiguration;
}) {
  const { jobs, extractor, ingestDocument, originals, semanticCache, engine, embeddingVersion, configuration } = dependencies;
  const ingestionGraph = new LangGraphIngestionWorkflow(
    jobs,
    extractor,
    ingestDocument,
    originals,
    semanticCache,
  );
  const ingestionPlan = createHash("sha256")
    .update(
      JSON.stringify([
        ingestionWorkflowVersion,
        configuration.CHUNK_SIZE,
        configuration.CHUNK_OVERLAP,
        configuration.PDF_OCR_ENABLED,
        configuration.PDF_OCR_LANGUAGES,
        configuration.PDF_OCR_MAX_PAGES,
        configuration.PDF_OCR_TIMEOUT_MS,
      ]),
    )
    .digest("hex");
  const ingestionInput = z.strictObject({
    jobId: z.string().uuid(),
    plan: z.string(),
    indexVersion: z.string(),
  });
  engine?.register("ingestion", {
    version: ingestionWorkflowVersion,
    authorize: async (lease) => {
      const input = ingestionInput.parse(lease.input),
        job = await jobs.readForProcessing(input.jobId, lease.tenantId);
      return (
        input.jobId === lease.runId &&
        input.plan === ingestionPlan &&
        input.indexVersion === (await embeddingVersion(lease.tenantId)) &&
        Boolean(
          job && (job.status === "processing" || job.status === "completed"),
        )
      );
    },
    run: async (lease, signal) => {
      const input = ingestionInput.parse(lease.input),
        job = await jobs.readForProcessing(input.jobId, lease.tenantId);
      if (!job) throw new WorkflowGuardError("authorization_revoked");
      const result = await ingestionGraph.execute(job, signal);
      return { resultId: result.id };
    },
  });
  const enqueueIngestion = engine
    ? async (
        job: IngestionJob,
      ) => {
        await engine.submit({
          tenantId: job.tenantId,
          actorId: "ingestion",
          runId: job.id,
          kind: "ingestion",
          version: ingestionWorkflowVersion,
          input: {
            jobId: job.id,
            plan: ingestionPlan,
            indexVersion: await embeddingVersion(job.tenantId),
          },
          budget: {
            maxSteps: 60,
            maxCalls: 1_024,
            maxInputTokens: 2_000_000,
            maxOutputTokens: 0,
            maxCostMicros: Math.floor(
              configuration.WORKFLOW_INGEST_MAX_COST_USD * 1_000_000,
            ),
            timeoutMs: 300_000,
          },
        });
      }
    : undefined;
  return enqueueIngestion;
}
