import { z } from "zod";

export * from "./mcp.js";
export * from "./discovery.js";
export * from "./usage.js";
export * from "./knowledge.js";
export * from "./workspaces.js";
export * from "./retrieval.js";
export * from "./documents.js";
export * from "./ingestion.js";
export * from "./evaluations.js";
export * from "./health.js";
export * from "./workflows.js";

export const chatPromptVariantIdSchema = z.enum(["balanced", "concise", "explanatory"]);
export type ChatPromptVariantId = z.infer<typeof chatPromptVariantIdSchema>;
export const chatPromptDescriptorSchema = z.object({ id: chatPromptVariantIdSchema, version: z.string().min(1).max(80) });
export type ChatPromptDescriptor = z.infer<typeof chatPromptDescriptorSchema>;

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
  promptComparisonAvailable: z.boolean().optional(),
  promptVariants: z.array(chatPromptDescriptorSchema).min(1).max(3).optional(),
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

export const MAX_PREVIOUS_CHAT_QUESTIONS = 3;
export const MAX_PREVIOUS_CHAT_QUESTION_LENGTH = 500;

export const questionInputSchema = z.object({
  question: z.string().min(1).max(5_000),
  topK: z.coerce.number().int().min(1).max(20).optional(),
  modelId: chatModelIdSchema.optional(),
  previousQuestions: z.array(z.string().trim().min(1).max(MAX_PREVIOUS_CHAT_QUESTION_LENGTH)).min(1).max(MAX_PREVIOUS_CHAT_QUESTIONS).optional()
});

export const questionComparisonInputSchema = z.strictObject({
  question: questionInputSchema.shape.question,
  topK: questionInputSchema.shape.topK,
  modelIds: z.tuple([configuredChatModelIdSchema, configuredChatModelIdSchema]),
  promptVariantIds: z.tuple([chatPromptVariantIdSchema, chatPromptVariantIdSchema]).optional()
}).superRefine(({ modelIds, promptVariantIds }, context) => {
  const differentModels = modelIds[0] !== modelIds[1];
  const differentPrompts = promptVariantIds !== undefined && promptVariantIds[0] !== promptVariantIds[1];
  if (differentModels === differentPrompts) context.addIssue({ code: "custom", path: ["modelIds"],
    message: "Compare different models with the same prompt, or different prompts with the same model." });
});

export const chatRunIdSchema = z.uuid();
export const questionStreamInputSchema = questionInputSchema.extend({ runId: chatRunIdSchema.optional(), conversationId: z.uuid().optional() })
  .refine((input) => !input.conversationId || (input.runId && !input.previousQuestions), { message: "Saved conversations require a run ID and server-owned context." });

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

export const questionResponseSchema = z.object({
  answer: z.string(),
  citedChunkIds: z.array(z.string()).optional(),
  structuredOutput: z.boolean().optional(),
  refusalReason: z.string().nullable().optional(),
  sources: z.array(questionSourceSchema),
  contextSources: z.array(questionSourceSchema).optional(),
  cacheHit: z.boolean().optional(),
  model: chatModelDescriptorSchema.optional(),
  providerModel: z.string().max(200).optional(),
  routing: chatAnswerRoutingSchema.optional(),
  usage: chatAnswerUsageSchema.optional(),
  claimVerification:z.object({method:z.enum(['judge','extractive']),supported:z.boolean(),claims:z.number().int().nonnegative(),unsupported:z.number().int().nonnegative()}).optional(),
  repaired:z.boolean().optional(),retrievalAttempts:z.number().int().min(1).max(2).optional()
});

const questionComparisonResultSchema = z.object({
  model: chatModelDescriptorSchema,
  providerModel: z.string().min(1).max(200).optional(),
  prompt: chatPromptDescriptorSchema.optional(),
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


export const CONVERSATION_RETENTION_DAYS = 90;
const conversationTitleSchema = z.string().trim().min(1).max(120).refine((title) => !/[\p{Cc}\p{Cf}]/u.test(title));
export const conversationCreateSchema = z.strictObject({ id: z.uuid(), title: conversationTitleSchema.optional() });
export const conversationRenameSchema = z.strictObject({ title: conversationTitleSchema });
export const conversationFeedbackSchema = z.strictObject({ value: z.enum(["up", "down"]).nullable() });
export const conversationSummarySchema = z.strictObject({
  id: z.uuid(), title: z.string().max(120).nullable(), turnCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), expiresAt: z.iso.datetime()
});
const conversationTurnBase = z.object({
  runId: z.uuid(), userMessageId: z.uuid(), assistantMessageId: z.uuid(), conversationId: z.uuid(),
  sequence: z.number().int().positive(), question: z.string().max(5000),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  answer: questionResponseSchema.nullable(), comparison: questionComparisonResponseSchema.nullable(),
  feedback: z.enum(["up", "down"]).nullable(), failureCode: z.string().max(80).nullable(),
  createdAt: z.iso.datetime(), completedAt: z.iso.datetime().nullable()
});
export const conversationTurnSchema = z.discriminatedUnion('mode',[
  conversationTurnBase.extend({mode:z.literal('answer'),input:questionInputSchema}),
  conversationTurnBase.extend({mode:z.literal('comparison'),input:questionComparisonInputSchema})
]);
export const conversationTurnResponseSchema = z.object({ turn: conversationTurnSchema });
export const conversationPageSchema = z.strictObject({ conversations: z.array(conversationSummarySchema).max(50), nextCursor: z.string().max(300).nullable() });
export const conversationMessagesSchema = z.strictObject({ conversation: conversationSummarySchema, turns: z.array(conversationTurnSchema).max(50), nextBefore: z.number().int().positive().nullable() });
export const conversationCreatedSchema = z.strictObject({ conversation: conversationSummarySchema });
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;
export type ConversationMessages = z.infer<typeof conversationMessagesSchema>;

export const workspaceMemberRoleSchema = z.enum(["editor", "viewer"]);

export const workspaceGuideSteps = ["purpose", "knowledge", "answer"] as const;
export const workspaceGuideGoals = ["knowledge", "support", "learning", "legal", "it", "custom"] as const;
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
