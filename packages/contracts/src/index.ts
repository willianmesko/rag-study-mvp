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

export const workspaceMemberRoleSchema = z.enum(["editor", "viewer"]);

export type DocumentInput = z.infer<typeof documentInputSchema>;
export type SearchInput = z.infer<typeof searchInputSchema>;
export type QuestionInput = z.infer<typeof questionInputSchema>;
export type WorkspaceMemberRole = z.infer<typeof workspaceMemberRoleSchema>;
