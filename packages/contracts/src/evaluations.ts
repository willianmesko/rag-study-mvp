import { z } from "zod";
import { demoSourceStateSchema } from "./discovery.js";
import { workflowSnapshotSchema } from "./workflows.js";

const ratio = z.number().min(0).max(1);
export const evaluationRunSchema = z.object({
  id: z.string().min(1),
  tenantId: z.uuid(),
  datasetName: z.string().min(1),
  datasetVersion: z.string().min(1),
  commitSha: z.string().nullable(),
  embeddingProvider: z.string().min(1),
  embeddingModel: z.string().min(1),
  chatProvider: z.string().min(1),
  // This is the provider's recorded model name, not a selectable model ID.
  chatModel: z.string().min(1),
  totalCases: z.number().int().nonnegative(),
  hitRate: ratio,
  meanReciprocalRank: ratio,
  faithfulness: ratio.nullable(),
  contextPrecision: ratio.nullable(),
  injectionPassRate: ratio,
  passed: z.boolean(),
  durationMs: z.number().nonnegative(),
  failureDetails: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export const evaluationsResponseSchema = z.object({
  runs: z.array(evaluationRunSchema).max(50),
  workflowAvailable: z.boolean().optional(),
  workflows: z.array(workflowSnapshotSchema).max(50).optional(),
  faithfulnessEnabled: z.boolean().optional(),
  reference: demoSourceStateSchema.extend({ ready: z.boolean() }).optional(),
});
export const evaluationCreatedResponseSchema = z.object({ run: evaluationRunSchema });

export type EvaluationRun = z.infer<typeof evaluationRunSchema>;
