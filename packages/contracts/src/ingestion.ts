import { z } from "zod";

export const uploadJobSchema = z.object({
  id: z.string().min(1),
  source: z.string().max(1_000),
  title: z.string().max(500).nullable(),
  filename: z.string(),
  mimeType: z.string().min(1),
  status: z.enum(["queued", "processing", "completed", "failed"]),
  progress: z.number().min(0).max(100),
  error: z.string().nullable(),
  chunkCount: z.number().int().nonnegative().nullable(),
  highRiskChunks: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const uploadsResponseSchema = z.object({ jobs: z.array(uploadJobSchema).max(30) });
export const uploadQueuedResponseSchema = z.object({ job: uploadJobSchema });
export const ingestionEventSchema = z.object({
  id: z.string().min(1),
  stage: z.string().min(1),
  status: z.enum(["started", "completed", "failed", "info"]),
  durationMs: z.number().nonnegative().nullable(),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export const ingestionEventsResponseSchema = z.object({ events: z.array(ingestionEventSchema).max(100) });
export const ingestionPassagePreviewSchema = z.object({
  totalChunks: z.number().int().nonnegative(),
  passages: z.array(z.object({
    chunkId: z.string().min(1),
    chunk: z.number().int().nonnegative(),
    excerpt: z.string().max(600),
    excerptTruncated: z.boolean(),
    previewBlocked: z.boolean(),
  })).max(3),
});
export const uploadCancelledResponseSchema = z.object({ jobId: z.string().min(1), status: z.literal("cancelled") });
export const uploadRetriedResponseSchema = z.object({ jobId: z.string().min(1), status: z.literal("queued") });

export type UploadJob = z.infer<typeof uploadJobSchema>;
export type IngestionEvent = z.infer<typeof ingestionEventSchema>;
export type IngestionPassagePreview = z.infer<typeof ingestionPassagePreviewSchema>;
