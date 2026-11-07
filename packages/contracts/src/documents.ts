import { z } from "zod";
import { passageSecuritySchema } from "./retrieval.js";

export const ingestResponseSchema = z.object({
  documentId: z.string().min(1),
  chunkCount: z.number().int().nonnegative(),
  highRiskChunks: z.number().int().nonnegative(),
});
export const managedDocumentSchema = z.object({
  id: z.string().min(1),
  source: z.string().max(1_000),
  title: z.string().max(500).nullable(),
  chunkCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  hasOriginal: z.boolean().optional(),
  format: z.enum(["pdf", "docx", "html", "markdown", "text"]).optional(),
  language: z.enum(["pt", "en", "mixed", "unknown", "und"]).optional(),
  sectionCount: z.number().int().nonnegative().optional(),
});
export const documentsResponseSchema = z.object({ documents: z.array(managedDocumentSchema).max(100) });
export const storedChunkSchema = z.object({
  id: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  content: z.string(),
  security: passageSecuritySchema,
  createdAt: z.iso.datetime(),
});
export const documentChunksResponseSchema = z.object({ chunks: z.array(storedChunkSchema).max(200) });

export type IngestResponse = z.infer<typeof ingestResponseSchema>;
export type ManagedDocument = z.infer<typeof managedDocumentSchema>;
export type StoredChunk = z.infer<typeof storedChunkSchema>;
