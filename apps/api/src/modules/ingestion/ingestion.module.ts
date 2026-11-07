import { createHash } from "node:crypto";
import { z } from "zod";
import type { IngestionJob, IngestionJobRepository } from "./application/ports/ingestion-job-repository.js";
import type { IngestionWorkflow, IngestionWorkflowOptions } from "./application/ports/ingestion-workflow.js";
import { WorkflowGuardError, type WorkflowEngine } from "../../platform/workflows/types.js";

export function createIngestionWorkflow(dependencies: {
  jobs: Required<Pick<IngestionJobRepository, "readForProcessing">>;
  workflow: IngestionWorkflow;
  engine?: Pick<WorkflowEngine, "register" | "submit">;
  embeddingVersion: (tenantId: string) => Promise<string>;
  options: IngestionWorkflowOptions;
}) {
  const { jobs, workflow, engine, embeddingVersion, options } = dependencies;
  const ingestionPlan = createHash("sha256")
    .update(
      JSON.stringify([
        workflow.version,
        options.chunkSize,
        options.chunkOverlap,
        options.ocrEnabled,
        options.ocrLanguages,
        options.ocrMaxPages,
        options.ocrTimeoutMs,
      ]),
    )
    .digest("hex");
  const ingestionInput = z.strictObject({
    jobId: z.string().uuid(),
    plan: z.string(),
    indexVersion: z.string(),
  });
  engine?.register("ingestion", {
    version: workflow.version,
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
      const result = await workflow.execute(job, signal);
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
          version: workflow.version,
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
              options.maxCostUsd * 1_000_000,
            ),
            timeoutMs: 300_000,
          },
        });
      }
    : undefined;
  return enqueueIngestion;
}
