import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.string().min(1),
  capabilities: z.object({
    durableConversations: z.boolean().optional(),
    durableWorkflows: z.boolean().optional(),
    pdfOcr: z.boolean().optional(),
  }).optional(),
});

export type Health = z.infer<typeof healthResponseSchema>;
