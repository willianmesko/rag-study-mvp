import { z } from "zod";

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const time = Date.parse(`${value}T00:00:00Z`);
  return !value.startsWith("0000-") && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}, "Choose a valid calendar date.");

export const documentFiltersSchema = z.strictObject({
  q: z.string().trim().min(1).max(500).optional(),
  documentId: z.uuid().optional(),
  source: z.string().trim().min(1).max(1_000).optional(),
  language: z.enum(["en", "pt", "mixed", "und"]).optional(),
  format: z.enum(["pdf", "docx", "html", "markdown", "text"]).optional(),
  from: calendarDate.optional(),
  to: calendarDate.optional()
}).refine(({ from, to }) => !from || !to || from <= to, { message: "The start date must not follow the end date.", path: ["to"] });
export type DocumentFilters = z.infer<typeof documentFiltersSchema>;

export const demoLibraryIdSchema = z.enum(["knowledge", "support", "learning", "rag-reference"]);
export const demoLocaleSchema = z.enum(["en", "pt-BR"]);
export const demoSourceStateSchema = z.object({
  source: z.string(), state: z.enum(["missing", "queued", "processing", "failed", "ready"]),
  documentId: z.uuid().nullable(), jobId: z.uuid().nullable()
});
export const demoDocumentSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,49}$/), source: z.string(), title: z.string(),
  filename: z.string(), format: z.enum(["markdown", "text", "html"]), language: z.enum(["en", "pt"]),
  content: z.string().max(40_000), preview: z.string().max(40_000).optional(), bytes: z.number().int().nonnegative()
});
export const demoLibrarySchema = z.object({
  id: demoLibraryIdSchema, version: z.string(), title: z.string(), description: z.string(),
  synthetic: z.literal(true), documents: z.array(demoDocumentSchema).min(1).max(5),
  questions: z.array(z.object({ question: z.string(), expectedSources: z.array(z.string()).min(1) })).min(1).max(10)
});
export const demoLibraryCatalogSchema = z.object({
  libraries: z.array(demoLibrarySchema).max(4), states: z.array(demoSourceStateSchema).max(20)
});
export const demoSeedResponseSchema = z.object({ state: demoSourceStateSchema, created: z.boolean() });
export type DemoLibrary = z.infer<typeof demoLibrarySchema>;
export type DemoSourceState = z.infer<typeof demoSourceStateSchema>;
