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

export const chatModelIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);

export const chatModelDescriptorSchema = z.object({
  id: chatModelIdSchema,
  label: z.string().min(1).max(80),
  provider: z.enum(["openrouter", "ollama", "bedrock"]),
  isDefault: z.boolean()
});

export const chatModelCatalogSchema = z.object({
  models: z.array(chatModelDescriptorSchema).min(1),
  comparisonAvailable: z.boolean(),
  autoAvailable: z.boolean().optional()
});

const configuredChatModelIdSchema = chatModelIdSchema.refine((id) => id !== "auto");
const uniqueModelIds = (ids: string[]) => new Set(ids).size === ids.length;
export const workspaceChatModelPolicySchema = z.strictObject({
  allowedModelIds: z.array(configuredChatModelIdSchema).min(1).max(6).refine(uniqueModelIds),
  defaultModelId: configuredChatModelIdSchema,
  auto: z.strictObject({
    simpleModelId: configuredChatModelIdSchema,
    complexModelId: configuredChatModelIdSchema,
    fallbackModelIds: z.array(configuredChatModelIdSchema).max(3).refine(uniqueModelIds)
  }).nullable()
}).refine(({ allowedModelIds, defaultModelId, auto }) => {
  const referenced = auto ? [defaultModelId, auto.simpleModelId, auto.complexModelId, ...auto.fallbackModelIds] : [defaultModelId];
  return referenced.every((id) => allowedModelIds.includes(id));
}, { message: "Every routing model must be enabled for the workspace." });
export const workspaceChatModelPolicyResponseSchema = z.object({
  policy: workspaceChatModelPolicySchema,
  availableModels: z.array(chatModelDescriptorSchema).min(1)
});

const chatAnswerRoutingSchema = z.object({
  mode: z.literal("auto"),
  reason: z.enum(["simple", "complex"]),
  attemptedModelIds: z.array(configuredChatModelIdSchema).max(4),
  usedFallback: z.boolean()
});

const chatAnswerUsageSchema = z.object({
  source: z.enum(["observed", "estimated", "cache", "none"]),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  observedCostUsd: z.number().nonnegative().optional(),
  promptVersion: z.string(),
  citationCount: z.number().int().nonnegative(),
  safetyOutcome: z.enum(["validated", "refused", "unstructured", "cached", "provider_failed"])
});

export const questionInputSchema = z.object({
  question: z.string().min(1).max(5_000),
  topK: z.coerce.number().int().min(1).max(20).optional(),
  modelId: chatModelIdSchema.optional()
});

export const questionComparisonInputSchema = z.strictObject({
  question: questionInputSchema.shape.question,
  topK: questionInputSchema.shape.topK,
  modelIds: z.tuple([chatModelIdSchema, chatModelIdSchema]).refine(([left, right]) => left !== right, {
    message: "Choose two different chat models."
  })
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
  cacheHit: z.boolean().optional(),
  model: chatModelDescriptorSchema.optional(),
  routing: chatAnswerRoutingSchema.optional(),
  usage: chatAnswerUsageSchema.optional()
});

const questionComparisonResultSchema = z.object({
  model: chatModelDescriptorSchema,
  latencyMs: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  response: questionResponseSchema.nullable(),
  error: z.literal("generation_failed").nullable()
});

export const questionComparisonResponseSchema = z.object({
  results: z.tuple([questionComparisonResultSchema, questionComparisonResultSchema])
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

export const workspaceGuideSteps = ["purpose", "knowledge", "answer"] as const;
export const workspaceGuideGoals = ["legal", "it", "custom"] as const;
export const workspaceOnboardingProgressSchema = z.strictObject({
  goal: z.enum(workspaceGuideGoals).nullable(),
  step: z.enum(workspaceGuideSteps),
  completed: z.boolean()
}).refine(({ goal, step, completed }) =>
  (goal !== null || step === "purpose") && (!completed || step === "answer"),
  { message: "Onboarding requires a goal before proceeding and the final step before completion." });
export const workspaceOnboardingResponseSchema = z.object({ progress: workspaceOnboardingProgressSchema.nullable() });

export type DocumentInput = z.infer<typeof documentInputSchema>;
export type SearchInput = z.infer<typeof searchInputSchema>;
export type QuestionInput = z.infer<typeof questionInputSchema>;
export type ChatModelDescriptor = z.infer<typeof chatModelDescriptorSchema>;
export type ChatModelCatalog = z.infer<typeof chatModelCatalogSchema>;
export type WorkspaceChatModelPolicy = z.infer<typeof workspaceChatModelPolicySchema>;
export type WorkspaceChatModelPolicyResponse = z.infer<typeof workspaceChatModelPolicyResponseSchema>;
export type ChatAnswerRouting = z.infer<typeof chatAnswerRoutingSchema>;
export type ChatAnswerUsage = z.infer<typeof chatAnswerUsageSchema>;
export type QuestionComparisonInput = z.infer<typeof questionComparisonInputSchema>;
export type QuestionComparisonResponse = z.infer<typeof questionComparisonResponseSchema>;
export type QuestionSource = z.infer<typeof questionSourceSchema>;
export type QuestionResponse = z.infer<typeof questionResponseSchema>;
export type ChatRunEvent = z.infer<typeof chatRunEventSchema>;
export type WorkspaceMemberRole = z.infer<typeof workspaceMemberRoleSchema>;
export type WorkspaceOnboardingProgress = z.infer<typeof workspaceOnboardingProgressSchema>;
