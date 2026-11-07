import { z } from "zod";

/** Counts only. Source text, filenames and job errors never cross this boundary. */
export const knowledgeStatusSchema = z.strictObject({
  indexedDocuments: z.number().int().nonnegative(),
  passages: z.number().int().nonnegative(),
  processingJobs: z.number().int().nonnegative(),
  failedJobs: z.number().int().nonnegative()
});

export type KnowledgeStatus = z.infer<typeof knowledgeStatusSchema>;
