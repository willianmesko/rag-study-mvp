import { z } from "zod";

/** Public progress only. Inputs, checkpoint contents, lease credentials and actor IDs stay on the server. */
export const workflowSnapshotSchema = z.object({
  runId: z.string().uuid(), kind: z.enum(["chat","ingestion","evaluation"]), version: z.string(),
  status: z.enum(["queued","running","waiting_approval","completed","failed","cancelled"]), stage: z.string().nullable(),
  steps:z.number().int().nonnegative(),calls:z.number().int().nonnegative(),inputTokens:z.number().int().nonnegative(),outputTokens:z.number().int().nonnegative(),costMicros:z.number().int().nonnegative(),
  budget:z.object({maxSteps:z.number(),maxCalls:z.number(),maxInputTokens:z.number(),maxOutputTokens:z.number(),maxCostMicros:z.number(),timeoutMs:z.number()}),
  attempts:z.number().int(),errorCode:z.string().nullable(),resultId:z.string().uuid().nullable(),createdAt:z.string().datetime(),updatedAt:z.string().datetime(),expiresAt:z.string().datetime()
});
export type WorkflowSnapshot = z.infer<typeof workflowSnapshotSchema>;

export const workflowResponseSchema = z.object({ workflow: workflowSnapshotSchema });
