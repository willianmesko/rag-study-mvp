import { z } from "zod";

export const passageSecuritySchema = z.object({
  promptInjectionRisk: z.enum(["low", "medium", "high"]),
  signals: z.array(z.string()),
});

export const searchResultSchema = z.object({
  chunkId: z.string().min(1),
  documentId: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  content: z.string().max(600),
  source: z.string().max(1_000),
  title: z.string().max(500).nullable(),
  // Similarity and reranker scores are measurements, not probabilities.
  score: z.number(),
  previewTruncated: z.boolean().optional(),
  previewBlocked: z.boolean().optional(),
  security: passageSecuritySchema,
  retrieval: z.object({
    vectorRank: z.number().int().positive().nullable(),
    keywordRank: z.number().int().positive().nullable(),
    fusionScore: z.number(),
  }).optional(),
  reranker: z.object({ rank: z.number().int().positive(), score: z.number() }).optional(),
});
export const searchResponseSchema = z.object({ results: z.array(searchResultSchema).max(20) });

export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
