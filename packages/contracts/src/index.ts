import { z } from "zod";

export const documentInputSchema = z.object({
  source: z.string().min(1).max(1_000),
  title: z.string().min(1).max(500).optional(),
  text: z.string().min(1).max(500_000),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const searchInputSchema = z.object({
  query: z.string().min(1).max(5_000),
  topK: z.coerce.number().int().min(1).max(20).optional()
});

export const questionInputSchema = z.object({
  question: z.string().min(1).max(5_000),
  topK: z.coerce.number().int().min(1).max(20).optional()
});

export const chatRunIdSchema = z.uuid();
export const questionStreamInputSchema = questionInputSchema.extend({ runId: chatRunIdSchema.optional() });

const questionSourceSchema = z.object({
  chunkId: z.string(),
  documentId: z.string(),
  source: z.string(),
  title: z.string().nullable(),
  chunk: z.number().int(),
  score: z.number(),
  excerpt: z.string(),
  excerptTruncated: z.boolean().optional()
});

const questionResponseSchema = z.object({
  answer: z.string(),
  citedChunkIds: z.array(z.string()).optional(),
  structuredOutput: z.boolean().optional(),
  refusalReason: z.string().nullable().optional(),
  sources: z.array(questionSourceSchema),
  contextSources: z.array(questionSourceSchema).optional(),
  cacheHit: z.boolean().optional()
});

export const chatRunEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["accepted", "retrieving", "generating", "validating", "cached"]) }),
  z.object({ type: z.literal("citations"), sources: z.array(questionSourceSchema) }),
  z.object({ type: z.literal("token"), delta: z.string() }),
  z.object({ type: z.literal("completed"), response: questionResponseSchema }),
  z.object({ type: z.literal("error"), code: z.enum(["quota_exceeded", "execution_failed", "execution_interrupted"]), error: z.string() }),
  z.object({ type: z.literal("cancelled") })
]);

export const workspaceMemberRoleSchema = z.enum(["editor", "viewer"]);

export type DocumentInput = z.infer<typeof documentInputSchema>;
export type SearchInput = z.infer<typeof searchInputSchema>;
export type QuestionInput = z.infer<typeof questionInputSchema>;
export type QuestionSource = z.infer<typeof questionSourceSchema>;
export type QuestionResponse = z.infer<typeof questionResponseSchema>;
export type ChatRunEvent = z.infer<typeof chatRunEventSchema>;
export type WorkspaceMemberRole = z.infer<typeof workspaceMemberRoleSchema>;
