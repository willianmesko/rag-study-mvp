import type { WorkspaceWorkflows } from "../../application/workflows/workspace-workflows.js";
import { WorkflowGuardError, WorkflowApprovalPending, type WorkflowSnapshot } from "../../application/workflows/types.js";
import { publicAnswerResponse, publicWorkflowEvent } from "../../application/policies/answer-response.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { chatModelIdSchema, chatRunIdSchema, demoLibraryIdSchema, demoLocaleSchema, documentFiltersSchema, documentInputSchema, questionComparisonInputSchema, questionInputSchema, questionStreamInputSchema, workspaceChatModelPolicySchema, workspaceMemberRoleSchema, workspaceOnboardingProgressSchema, type DocumentFilters, type ChatModelDescriptor, type ChatRunEvent } from "@rag-study/contracts";
import { demoLibraries } from "../../application/demo-libraries/catalog.js";
import { chatPromptDescriptors } from "../../application/policies/grounded-answer-policy.js";
import type { DemoLibraryRepository } from "../../application/ports/demo-library-repository.js";
import { ExistingIngestionSourceError } from "../../application/ports/ingestion-job-repository.js";
import { ZodError, z } from "zod";
import type { AnswerQuestionUseCase } from "../../application/use-cases/answer-question.js";
import type { CompareAnswersUseCase, ComparisonModel } from "../../application/use-cases/compare-answers.js";
import { AutoAnswerFailedError, type RouteAnswerUseCase } from "../../application/use-cases/route-answer.js";
import { defaultWorkspaceChatPolicy, resolveWorkspaceChatModels } from "../../application/policies/workspace-chat-models.js";
import type { WorkspaceModelPolicyRepository } from "../../application/ports/workspace-model-policy-repository.js";
import { EmbeddingIndexChangedError } from "../../application/ports/workspace-embedding-index.js";
import { evaluationEffortSchema } from "../../application/evaluation/evaluation-effort.js";
import { ChatBudgetExceededError } from "../../application/policies/chat-cost.js";
import { StreamAnswerRuns } from "../../application/use-cases/stream-answer-runs.js";
import type { ChatRunRepository } from "../../application/ports/chat-run-repository.js";
import type { WorkspaceOnboardingRepository } from "../../application/ports/workspace-onboarding-repository.js";
import type { AnswerQuestionResult, AnswerWorkflowEvent } from "../../application/ports/question-answering-workflow.js";
import type { IngestDocumentUseCase } from "../../application/use-cases/ingest-document.js";
import type { SearchDocumentsUseCase } from "../../application/use-cases/search-documents.js";
import type { QueueDocumentUploadUseCase } from "../../application/use-cases/queue-document-upload.js";
import type { ProcessNextIngestionJobUseCase } from "../../application/use-cases/process-next-ingestion-job.js";
import type { RetryIngestionJobUseCase } from "../../application/use-cases/retry-ingestion-job.js";
import type { ReindexDocumentUseCase } from "../../application/use-cases/reindex-document.js";
import type { DeleteDocumentUseCase } from "../../application/use-cases/delete-document.js";
import type { GetDocumentOriginalUseCase } from "../../application/use-cases/get-document-original.js";
import type { IngestionJob, IngestionJobEvent, IngestionJobRepository } from "../../application/ports/ingestion-job-repository.js";
import type { ManagedDocument, StoredChunk } from "../../application/ports/document-repository.js";
import type { AuditEventRepository } from "../../application/ports/audit-event-repository.js";
import type { QuotaResult } from "../../application/ports/quota-repository.js";
import type { UsageSummary } from "../../application/ports/usage-metrics-repository.js";
import type { EvaluationRun } from "../../application/ports/evaluation-repository.js";
import { EvaluationRunError, type RunEvaluationUseCase } from "../../application/use-cases/run-evaluation.js";
import type { TenantMembership, TenantRole, WorkspaceMember } from "../../application/ports/tenant-membership-repository.js";
import { PublicHtmlFetchError, type PublicHtmlFetchErrorCode, type PublicHtmlFetcher } from "../../application/ports/public-html-fetcher.js";
import { config } from "../../config.js";
import { redactPii } from "../../domain/security/pii-redaction.js";
import { isSafeForAnswer, type PromptInjectionAssessment } from "../../domain/security/prompt-injection.js";
import { openAnswerStream, replayAnswerStream } from "./answer-stream.js";
import { withReplySignal } from "./reply-signal.js";
import { registerWorkspaceMcpRoutes, type WorkspaceMcp } from "./workspace-mcp.js";
import { registerAgentActionRoutes, type AgentActions } from "./agent-actions.js";
import { safeHttpLogSerializers } from "./safe-logging.js";

const searchSchema = z.object({ q: z.string().min(1).max(5_000), topK: z.coerce.number().int().min(1).max(20).optional() });
const invitationSchema = z.object({ email: z.string().email().max(320).transform((value) => value.trim().toLowerCase()), role: workspaceMemberRoleSchema });
const memberRoleSchema = z.object({ role: workspaceMemberRoleSchema });
const workspaceIdSchema = z.string().uuid();
const workspaceRequired = { ok: false, status: 400, error: "Select a workspace.", code: "workspace_required" } as const;
const chatRunParams = z.object({ runId: chatRunIdSchema });
const chatRunCursor = z.object({ after: z.coerce.number().int().min(0).max(2_147_483_647).default(0) });
const evaluationInput = z.strictObject({ includeFaithfulness: z.boolean().optional(), modelId: chatModelIdSchema.optional(), effort: evaluationEffortSchema.optional() });
const modelUnavailable = { code: "model_unavailable", error: "Select an available chat model." } as const;
const maxPassageExcerptChars = 600;
const urlImportSchema = z.object({ url: z.string().trim().min(1).max(1_000).url(), title: z.string().trim().min(1).max(500).optional() });
const urlImportStatus: Record<PublicHtmlFetchErrorCode, number> = {
  invalid_url: 400,
  unsafe_destination: 400,
  dns_failed: 502,
  redirect_limit: 502,
  fetch_failed: 502,
  unsupported_content_type: 415,
  response_too_large: 413,
  invalid_encoding: 415,
  fetch_timeout: 504
};

type HttpDependencies = {
  ingestDocument: IngestDocumentUseCase;
  searchDocuments: SearchDocumentsUseCase;
  answerQuestion: AnswerQuestionUseCase;
  chatModels: ReadonlyMap<string, ComparisonModel & { answerQuestion: AnswerQuestionUseCase }>;
  workspaceModelPolicies: WorkspaceModelPolicyRepository;
  workspaceMcp?: WorkspaceMcp;
  agentActions?: AgentActions;
  compareAnswers: CompareAnswersUseCase;
  routeAnswer: RouteAnswerUseCase;
  chatRuns: ChatRunRepository;
  workspaceOnboarding: WorkspaceOnboardingRepository;
  queueDocumentUpload: QueueDocumentUploadUseCase;
  publicHtmlFetcher: PublicHtmlFetcher;
  processNextIngestionJob: ProcessNextIngestionJobUseCase;
  retryIngestionJob: RetryIngestionJobUseCase;
  listIngestionJobs: (tenantId: string, limit: number) => Promise<Omit<IngestionJob, "payload">[]>;
  listIngestionEvents: (jobId: string, tenantId: string, limit: number) => Promise<IngestionJobEvent[]>;
  previewIngestionPassages: IngestionJobRepository["previewPassages"];
  listMemberships: (userId: string, limit?: number) => Promise<TenantMembership[]>;
  findMembership: (userId: string, tenantId: string) => Promise<TenantMembership | null>;
  createWorkspace: (input: { userId: string; name: string; slug: string }) => Promise<TenantMembership>;
  listWorkspaceMembers: (tenantId: string) => Promise<WorkspaceMember[]>;
  addWorkspaceMember: (input: { tenantId: string; userId: string; role: Exclude<TenantRole, "owner"> }) => Promise<boolean>;
  changeWorkspaceMemberRole: (input: { tenantId: string; userId: string; role: Exclude<TenantRole, "owner"> }) => Promise<boolean>;
  removeWorkspaceMember: (input: { tenantId: string; userId: string }) => Promise<boolean>;
  recordWorkspaceInvitation: (input: { tenantId: string; email: string; role: Exclude<TenantRole, "owner">; invitedBy: string; invitedUserId: string }) => Promise<void>;
  listDocuments: (tenantId: string, limit: number, filters?: DocumentFilters) => Promise<ManagedDocument[]>;
  demoLibraryRepository?: DemoLibraryRepository;
  listDocumentChunks: (tenantId: string, documentId: string, limit: number) => Promise<StoredChunk[]>;
  getDocumentOriginal: Pick<GetDocumentOriginalUseCase, "execute">;
  reindexDocument: ReindexDocumentUseCase;
  deleteDocument: DeleteDocumentUseCase;
  consumeQuestionQuota: (tenantId: string, actorKey: string, units?: 1 | 2, receiptKey?: string) => Promise<QuotaResult>;
  consumeAdminUploadQuota: (tenantId: string, actorKey: string, bytes: number) => Promise<QuotaResult>;
  getUsageSummary: (tenantId: string, days: number) => Promise<UsageSummary>;
  listEvaluationRuns: (tenantId: string, limit: number) => Promise<EvaluationRun[]>;
  runEvaluation: RunEvaluationUseCase;
  workflows?: WorkspaceWorkflows;
  cancelIngestion?: (tenantId: string, jobId: string) => Promise<boolean>;
  invalidateSemanticCache: (tenantId: string) => Promise<void>;
  recordAuditEvent: AuditEventRepository["record"];
};

type ScopeFailure = {
  ok: false;
  status: number;
  error: string;
  code?: "workspace_required" | "invalid_workspace";
};

function rejectScope(reply: FastifyReply, failure: ScopeFailure) {
  return reply.code(failure.status).send({ error: failure.error, code: failure.code });
}

function matchesApiKey(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const actual = Buffer.from(candidate);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function originalFileDisposition(value: string): string {
  const basename = (value.split(/[/\\]/).at(-1) ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const filename = Array.from(basename).slice(0, 240).join("") || "document";
  const ascii = filename.replace(/[^a-zA-Z0-9 ._-]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function applyCorsHeaders(origin: string | undefined, reply: { header: (name: string, value: string) => unknown }): boolean {
  if (!origin) return true;
  if (!config.ALLOWED_ORIGINS.includes(origin)) return false;
  reply.header("access-control-allow-origin", origin);
  reply.header("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  reply.header("access-control-allow-headers", "authorization, content-type, idempotency-key, x-document-source, x-document-title, x-workspace-id");
  reply.header("access-control-max-age", "600");
  reply.header("vary", "Origin");
  return true;
}

function anonymousActorKey(request: { headers: Record<string, string | string[] | undefined>; ip?: string }): string {
  // Do not trust a client-supplied X-Forwarded-For value for quota identity.
  // Render/Fastify can be configured with a trusted proxy separately when a
  // production deployment needs the original address.
  const source = request.ip ?? "unknown";
  const secret = config.USAGE_HASH_SECRET ?? config.SUPABASE_SERVICE_ROLE_KEY ?? config.ADMIN_API_KEY ?? "local-development-only-not-for-production";
  return `anonymous:${createHmac("sha256", secret).update(source).digest("hex").slice(0, 32)}`;
}

export async function buildApp(dependencies: HttpDependencies) {
  const app = Fastify({ logger: { serializers: safeHttpLogSerializers }, bodyLimit: config.UPLOAD_MAX_BYTES + 100_000 });
  const streamShutdown = new AbortController();
  const answerRuns = new StreamAnswerRuns(dependencies.chatRuns, config.AGENT_TIMEOUT_MS);
  app.addHook("preClose", async () => { streamShutdown.abort(); });
  app.addHook("onClose", async () => { await dependencies.workflows?.close(); await answerRuns.close(); });
  app.addHook("onReady", async () => { dependencies.workflows?.start(); });
  await app.register(multipart, { limits: { files: 1, fileSize: config.UPLOAD_MAX_BYTES, fields: 0 } });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    errorResponseBuilder: () => ({ error: "Too many requests. Try again later." })
  });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    reply.header("permissions-policy", "accelerometer=(), camera=(), geolocation=(), microphone=()");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("x-request-id", request.id);
    return payload;
  });
  app.addHook("onRequest", async (request, reply) => {
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
    const originAllowed = applyCorsHeaders(origin, reply);
    if (!originAllowed) return reply.code(403).send({ error: "Origin not allowed" });
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
    const providedApiKey = request.headers["x-api-key"];
    const apiKey = typeof providedApiKey === "string" ? providedApiKey : undefined;
    if (config.API_KEY && !matchesApiKey(apiKey, config.API_KEY)) return reply.code(401).send({ error: "Unauthorized" });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof WorkflowApprovalPending) return reply.code(409).send({code:'approval_required',error:error.message});
    if (error instanceof WorkflowGuardError) {
      const status = { budget_exceeded:422,lease_lost:409,cancelled:409,deadline_exceeded:504,authorization_revoked:403,definition_changed:409,state_limit:422,queue_full:429 }[error.code];
      return reply.code(status).send({code:error.code,error:error.message});
    }
    if (error instanceof ZodError) return reply.code(400).send({ error: "Invalid request", details: error.flatten() });
    if (error instanceof ChatBudgetExceededError) return reply.code(422).send({ code: "chat_budget_exceeded", error: error.message });
    if (error instanceof AutoAnswerFailedError) return reply.code(503).send({ code: "auto_generation_failed", error: error.message });
    if (error instanceof EmbeddingIndexChangedError) return reply.code(409).send({ code: "embedding_index_changed", error: "The workspace index changed. Try again." });
    if (error instanceof EvaluationRunError) {
      const status = { evaluation_in_progress: 409, judge_unavailable: 503, model_unavailable: 400, evaluation_reference_missing: 409 }[error.code];
      return reply.code(status).send({ code: error.code, error: error.message });
    }
    if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 429) {
      return reply.code(429).send({ error: "Too many requests. Try again later." });
    }
    app.log.error({ code: "request_failed", err: error }, "Request failed");
    return reply.code(500).send({ error: "Internal server error" });
  });
  app.get("/health", async () => ({ status: "ok", capabilities: { pdfOcr: config.PDF_OCR_ENABLED, durableWorkflows: Boolean(dependencies.workflows) } }));
  const authorizeMember = async (request: { headers: Record<string, string | string[] | undefined> }, requireExplicitWorkspace = false) => {
    if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) return { ok: false as const, status: 503, error: "Admin upload is not configured." };
    const authorization = request.headers.authorization;
    const token = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    if (!token) return { ok: false as const, status: 401, error: "Authentication required." };
    const workspaceHeader = request.headers["x-workspace-id"];
    const requestedWorkspace = workspaceHeader === undefined ? undefined : workspaceIdSchema.safeParse(workspaceHeader);
    if (requestedWorkspace && !requestedWorkspace.success) {
      return { ok: false as const, status: 400, error: "Select a valid workspace.", code: "invalid_workspace" as const };
    }
    if (requireExplicitWorkspace && !requestedWorkspace) return workspaceRequired;
    const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return { ok: false as const, status: 403, error: "Administrator access required." };

    let membership: TenantMembership | null | undefined;
    if (requestedWorkspace) {
      membership = await dependencies.findMembership(data.user.id, requestedWorkspace.data);
    } else {
      const memberships = await dependencies.listMemberships(data.user.id, 2);
      if (memberships.length > 1) return workspaceRequired;
      membership = memberships[0];
    }
    if (!membership) return { ok: false as const, status: 403, error: "Workspace membership required." };
    return { ok: true as const, userId: data.user.id, tenantId: membership.tenantId, role: membership.role };
  };
  const authorizeAdmin = async (request: { headers: Record<string, string | string[] | undefined> }, requireExplicitWorkspace = false) => {
    const authorization = await authorizeMember(request, requireExplicitWorkspace);
    if (!authorization.ok) return authorization;
    if (authorization.role === "viewer") return { ok: false as const, status: 403, error: "Editor or owner access required." };
    return authorization;
  };
  const authorizeOwner = async (request: { headers: Record<string, string | string[] | undefined> }, requireExplicitWorkspace = false) => {
    const authorization = await authorizeMember(request, requireExplicitWorkspace);
    if (!authorization.ok) return authorization;
    if (authorization.role !== "owner") return { ok: false as const, status: 403, error: "Workspace owner access required." };
    return authorization;
  };
  if (dependencies.workspaceMcp) {
    registerWorkspaceMcpRoutes(app, {
      ...dependencies.workspaceMcp, authorize: (request) => authorizeMember(request, true),
      audit: dependencies.recordAuditEvent, shutdown: streamShutdown.signal
    });
  }
  if (dependencies.agentActions) {
    registerAgentActionRoutes(app, dependencies.agentActions, (request) => authorizeMember(request, true));
  }
  async function resolveQueryScope(request: FastifyRequest, requireExplicitWorkspace = false) {
    if (requireExplicitWorkspace || (typeof request.headers.authorization === "string" && request.headers.authorization.startsWith("Bearer "))) {
      const membership = await authorizeMember(request, requireExplicitWorkspace);
      if (!membership.ok) return membership;
      return { ok: true as const, tenantId: membership.tenantId, actorKey: `user:${membership.userId}`, authenticated: true };
    }

    const requestsPrivateAccess = request.headers.authorization !== undefined || request.headers["x-workspace-id"] !== undefined;
    const requiresProductionAuth = process.env.NODE_ENV === "production" && !config.DEMO_MODE && !config.API_KEY;
    if (requestsPrivateAccess || requiresProductionAuth) {
      return { ok: false as const, status: 401, error: "Authentication required." };
    }
    return { ok: true as const, tenantId: config.DEFAULT_TENANT_ID, actorKey: anonymousActorKey(request), authenticated: false };
  }
  const globalChatModels = dependencies.chatModels ?? new Map<string, ComparisonModel & { answerQuestion: AnswerQuestionUseCase }>();
  const defaultChatPolicy = defaultWorkspaceChatPolicy(globalChatModels);
  async function workspaceChatModels(tenantId?: string) {
    const policy = tenantId ? await dependencies.workspaceModelPolicies?.get(tenantId) : null;
    return resolveWorkspaceChatModels(globalChatModels, policy ?? defaultChatPolicy);
  }
  async function chooseAnswer(tenantId: string | undefined, modelId?: string) {
    if (!modelId && globalChatModels.size === 0) return dependencies.answerQuestion.execute.bind(dependencies.answerQuestion);
    const profile = await workspaceChatModels(tenantId);
    if (modelId === "auto") {
      const auto = profile.auto;
      const simple = auto && profile.models.get(auto.simpleModelId);
      const complex = auto && profile.models.get(auto.complexModelId);
      if (!auto || !simple || !complex) return null;
      const fallbacks = auto.fallbackModelIds.flatMap((id) => {
        const model = profile.models.get(id);
        return model ? [model] : [];
      });
      return (input: Parameters<AnswerQuestionUseCase["execute"]>[0]) =>
        dependencies.routeAnswer.execute({ ...input, simple, complex, fallbacks,
          reserveFallbackQuota: async (id) => (await dependencies.consumeQuestionQuota(input.tenantId, input.actorKey, undefined, `fallback:${id}`)).allowed });
    }
    const model = profile.models.get(modelId ?? profile.defaultModelId ?? "");
    if (!model) return null;
    return async (input: Parameters<AnswerQuestionUseCase["execute"]>[0]) =>
      ({ ...await model.answerQuestion.execute(input), model: model.descriptor });
  }
  app.get("/v1/workspaces", async (request, reply) => {
    if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) return reply.code(503).send({ error: "Workspace access is not configured." });
    const authorization = request.headers.authorization;
    const token = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    if (!token) return reply.code(401).send({ error: "Authentication required." });
    const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return reply.code(403).send({ error: "Authentication required." });
    return { workspaces: await dependencies.listMemberships(data.user.id) };
  });
  app.post("/v1/workspaces", async (request, reply) => {
    if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) return reply.code(503).send({ error: "Workspace access is not configured." });
    const token = typeof request.headers.authorization === "string" && request.headers.authorization.startsWith("Bearer ") ? request.headers.authorization.slice(7) : undefined;
    if (!token) return reply.code(401).send({ error: "Authentication required." });
    const supabase=createClient(config.SUPABASE_URL,config.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await supabase.auth.getUser(token); if(error||!data.user)return reply.code(403).send({error:"Authentication required."});
    const input=z.object({name:z.string().trim().min(2).max(100),slug:z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,60}$/)}).parse(request.body);
    try{return reply.code(201).send({workspace:await dependencies.createWorkspace({userId:data.user.id,...input})});}catch{return reply.code(409).send({error:"Workspace name or slug already exists."});}
  });
  app.route({
    method: ["GET", "PATCH"],
    url: "/v1/workspaces/:workspaceId/onboarding",
    exposeHeadRoute: false,
    bodyLimit: 2_048,
    async handler(request, reply) {
      const authorization = await authorizeMember(request, true);
      if (!authorization.ok) return rejectScope(reply, authorization);
      const { workspaceId } = z.object({ workspaceId: workspaceIdSchema }).parse(request.params);
      const { tenantId, userId } = authorization;
      if (workspaceId !== tenantId) return reply.code(403).send({ error: "Select the workspace you want to open." });

      const scope = { tenantId, userId };
      const progress = request.method === "PATCH"
        ? await dependencies.workspaceOnboarding.save(scope, workspaceOnboardingProgressSchema.parse(request.body))
        : await dependencies.workspaceOnboarding.get(scope);
      return { progress };
    }
  });
  app.get("/v1/workspaces/:workspaceId/members", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    if (workspaceId !== authorization.tenantId) return reply.code(403).send({ error: "Select the workspace you want to manage." });
    if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) return reply.code(503).send({ error: "Member management is not configured." });
    const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return reply.code(502).send({ error: "Unable to load workspace members." });
    const emails = new Map(data.users.map((user) => [user.id, user.email ?? null]));
    const members = await dependencies.listWorkspaceMembers(authorization.tenantId);
    return { members: members.map((member) => ({ userId: member.userId, email: emails.get(member.userId) ?? null, role: member.role, createdAt: member.createdAt.toISOString() })) };
  });
  app.post("/v1/workspaces/:workspaceId/invitations", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    if (workspaceId !== authorization.tenantId) return reply.code(403).send({ error: "Select the workspace you want to manage." });
    if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY || !config.APP_BASE_URL) return reply.code(503).send({ error: "Invitations are not configured." });
    const input = invitationSchema.parse(request.body);
    const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, { redirectTo: config.APP_BASE_URL });
    if (error || !data.user) return reply.code(409).send({ error: error?.message ?? "Unable to invite this email." });
    const added = await dependencies.addWorkspaceMember({ tenantId: authorization.tenantId, userId: data.user.id, role: input.role });
    if (!added) return reply.code(409).send({ error: "This person already belongs to the workspace." });
    await dependencies.recordWorkspaceInvitation({ tenantId: authorization.tenantId, email: input.email, role: input.role, invitedBy: authorization.userId, invitedUserId: data.user.id });
    await dependencies.recordAuditEvent({ tenantId: authorization.tenantId, actorUserId: authorization.userId, action: "workspace.member_invited", resourceType: "tenant_membership", resourceId: null, requestId: request.id, metadata: { role: input.role } });
    return reply.code(201).send({ member: { userId: data.user.id, email: input.email, role: input.role } });
  });
  app.patch("/v1/workspaces/:workspaceId/members/:userId", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { workspaceId, userId } = z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }).parse(request.params);
    if (workspaceId !== authorization.tenantId) return reply.code(403).send({ error: "Select the workspace you want to manage." });
    const { role } = memberRoleSchema.parse(request.body);
    const updated = await dependencies.changeWorkspaceMemberRole({ tenantId: authorization.tenantId, userId, role });
    if (!updated) return reply.code(409).send({ error: "Owners cannot have their role changed." });
    return reply.code(204).send();
  });
  app.delete("/v1/workspaces/:workspaceId/members/:userId", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { workspaceId, userId } = z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }).parse(request.params);
    if (workspaceId !== authorization.tenantId) return reply.code(403).send({ error: "Select the workspace you want to manage." });
    const removed = await dependencies.removeWorkspaceMember({ tenantId: authorization.tenantId, userId });
    if (!removed) return reply.code(409).send({ error: "Owners cannot be removed." });
    return reply.code(204).send();
  });
  async function queueWorkspaceUpload(
    actor: { tenantId: string; userId: string }, requestId: string,
    upload: Omit<Parameters<QueueDocumentUploadUseCase["execute"]>[0], "tenantId">,
    sourceType: "file" | "url" | "demo"
  ) {
    const quota = await dependencies.consumeAdminUploadQuota(actor.tenantId, actor.userId, upload.payload.byteLength);
    if (!quota.allowed) return null;
    const job = await dependencies.queueDocumentUpload.execute({ ...upload, tenantId: actor.tenantId });
    await dependencies.recordAuditEvent({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "document.upload_queued",
      resourceType: "ingestion_job",
      resourceId: job.id,
      requestId,
      metadata: { bytes: upload.payload.byteLength, mimeType: upload.mimeType, sourceType }
    });
    return job;
  }

  app.get("/v1/demo-libraries", { exposeHeadRoute: false }, async (request, reply) => {
    const actor = await authorizeMember(request, true);
    if (!actor.ok) return rejectScope(reply, actor);
    const repository = dependencies.demoLibraryRepository;
    if (!repository) return reply.code(503).send({ error: "Demonstration libraries are unavailable." });
    const { locale } = z.strictObject({ locale: demoLocaleSchema.default("en") }).parse(request.query);
    const libraries = demoLibraries(locale);
    const sources = libraries.flatMap(({ documents }) => documents.map(({ source }) => source));
    return { libraries, states: await repository.sourceStates(actor.tenantId, sources) };
  });
  app.post("/v1/admin/demo-libraries/:libraryId/documents/:documentKey", { bodyLimit: 2_048, config: { rateLimit: { max: 20 } } }, async (request, reply) => {
    const actor = await authorizeAdmin(request, true);
    if (!actor.ok) return rejectScope(reply, actor);
    const repository = dependencies.demoLibraryRepository;
    if (!repository) return reply.code(503).send({ error: "Demonstration libraries are unavailable." });
    const { libraryId, documentKey } = z.strictObject({ libraryId: demoLibraryIdSchema, documentKey: z.string().regex(/^[a-z][a-z0-9-]{0,49}$/) }).parse(request.params);
    const { locale } = z.strictObject({ locale: demoLocaleSchema }).parse(request.body);
    const document = demoLibraries(locale).find(({ id }) => id === libraryId)?.documents.find(({ id }) => id === documentKey);
    if (!document) return reply.code(404).send({ error: "Choose a document from an available demonstration library." });
    const existing = (await repository.sourceStates(actor.tenantId, [document.source]))[0];
    if (existing && ["ready", "queued", "processing"].includes(existing.state)) return { created: false, state: existing };
    try {
      const job = await queueWorkspaceUpload(actor, request.id, {
        source: document.source, title: document.title, filename: document.filename,
        mimeType: { markdown: "text/markdown", text: "text/plain", html: "text/html" }[document.format],
        payload: Buffer.from(document.content), onlyIfMissing: true
      }, "demo");
      if (!job) return reply.code(429).send({ error: "Daily upload quota reached. Try again tomorrow." });
      return reply.code(202).send({ created: true, state: { source: document.source, state: "queued", jobId: job.id, documentId: null } });
    } catch (error) {
      if (!(error instanceof ExistingIngestionSourceError)) throw error;
      return { created: false, state: { source: error.source, state: error.state, documentId: error.documentId, jobId: error.jobId } };
    }
  });

  app.post("/v1/admin/uploads", async (request, reply) => {
    const authorization = await authorizeAdmin(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "A document file is required." });
    const sourceHeader = request.headers["x-document-source"];
    const titleHeader = request.headers["x-document-title"];
    const input = z.object({ source: z.string().min(3).max(1_000), title: z.string().min(1).max(500).optional() }).parse({ source: sourceHeader ?? `upload/${file.filename}`, title: titleHeader || undefined });
    const job = await queueWorkspaceUpload(authorization, request.id, {
      ...input, filename: file.filename, mimeType: file.mimetype || "application/octet-stream", payload: await file.toBuffer()
    }, "file");
    if (!job) return reply.code(429).send({ error: "Daily upload quota reached. Try again tomorrow." });
    return reply.code(202).send({ job: serializeJob(job) });
  });
  app.post("/v1/admin/uploads/url", { bodyLimit: 8_000, config: { rateLimit: { max: 6 } } }, async (request, reply) => {
    const authorization = await authorizeAdmin(request, true);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { url, title } = urlImportSchema.parse(request.body);
    let page: Awaited<ReturnType<PublicHtmlFetcher["fetch"]>>;
    try {
      page = await dependencies.publicHtmlFetcher.fetch(url);
    } catch (error) {
      if (!(error instanceof PublicHtmlFetchError)) throw error;
      return reply.code(urlImportStatus[error.code]).send({ error: error.message, code: error.code });
    }
    const job = await queueWorkspaceUpload(authorization, request.id, {
      source: page.url, title, filename: page.filename, mimeType: "text/html", payload: page.payload
    }, "url");
    if (!job) return reply.code(429).send({ error: "Daily upload quota reached. Try again tomorrow." });
    return reply.code(202).send({ job: serializeJob(job) });
  });
  app.get("/v1/admin/uploads", async (request, reply) => {
    const authorization = await authorizeMember(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    return { jobs: (await dependencies.listIngestionJobs(authorization.tenantId, 30)).map(serializeJob) };
  });
  app.get("/v1/admin/uploads/:jobId/events", async (request, reply) => {
    const authorization = await authorizeMember(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    return { events: (await dependencies.listIngestionEvents(jobId, authorization.tenantId, 100)).map(serializeIngestionEvent) };
  });
  app.get("/v1/admin/uploads/:jobId/preview", { exposeHeadRoute: false }, async (request, reply) => {
    const authorization = await authorizeAdmin(request, true);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const preview = await dependencies.previewIngestionPassages({ jobId, tenantId: authorization.tenantId });
    if (!preview) return reply.code(404).send({ error: "The current indexed passages are not available for this job." });
    await dependencies.recordAuditEvent({
      tenantId: authorization.tenantId,
      actorUserId: authorization.userId,
      action: "ingestion.preview_read",
      resourceType: "ingestion_job",
      resourceId: jobId,
      requestId: request.id,
      metadata: {}
    });
    return {
      totalChunks: preview.totalChunks,
      passages: preview.passages.map(({ chunkId, ordinal, content, security }) => ({
        chunkId, chunk: ordinal, ...restrictedPassagePreview(content, security)
      }))
    };
  });
  app.get("/v1/admin/usage", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }).parse(request.query);
    const summary = await dependencies.getUsageSummary(authorization.tenantId, days);
    return { days, summary, alert: { thresholdUsd: config.USAGE_ALERT_THRESHOLD_USD, triggered: (summary.effectiveCostUsd ?? summary.estimatedCostUsd) >= config.USAGE_ALERT_THRESHOLD_USD } };
  });
  app.get("/v1/admin/chat-model-policy", { exposeHeadRoute: false }, async (request, reply) => {
    const authorization = await authorizeOwner(request, true);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const policy = await dependencies.workspaceModelPolicies.get(authorization.tenantId) ?? defaultChatPolicy;
    return { policy, availableModels: Array.from(globalChatModels.values(), ({ descriptor }) => descriptor) };
  });
  app.patch("/v1/admin/chat-model-policy", { bodyLimit: 4_096 }, async (request, reply) => {
    const authorization = await authorizeOwner(request, true);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const input = workspaceChatModelPolicySchema.parse(request.body);
    if (input.allowedModelIds.some((id) => !globalChatModels.has(id))) return reply.code(400).send(modelUnavailable);
    const policy = await dependencies.workspaceModelPolicies.save(authorization.tenantId, input);
    await dependencies.recordAuditEvent({
      tenantId: authorization.tenantId, actorUserId: authorization.userId, action: "chat.model_policy_updated",
      resourceType: "workspace_model_policy", resourceId: null, requestId: request.id,
      metadata: { allowedModelCount: policy.allowedModelIds.length, autoEnabled: policy.auto !== null }
    });
    return { policy, availableModels: Array.from(globalChatModels.values(), ({ descriptor }) => descriptor) };
  });
  app.get("/v1/admin/evaluations", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    const reference = (await dependencies.demoLibraryRepository?.sourceStates(authorization.tenantId, ["golden/rag-fundamentals"]))?.[0];
    return { workflowAvailable: Boolean(dependencies.workflows), workflows: dependencies.workflows ? (await dependencies.workflows.repository.list(authorization.tenantId, "evaluation", limit)).map(serializeWorkflow) : [], runs: (await dependencies.listEvaluationRuns(authorization.tenantId, limit)).map(serializeEvaluationRun), faithfulnessEnabled: dependencies.runEvaluation.supportsFaithfulness,
      ...(reference ? { reference: { ...reference, ready: reference.state === "ready" } } : {}) };
  });
  app.post("/v1/admin/evaluations/run", { config: { rateLimit: { max: 2 } } }, async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const input = evaluationInput.parse(request.body ?? {});
    if (dependencies.workflows) return reply.code(409).send({code:"durable_evaluation_required",error:"Start a durable evaluation from the evaluation center."});
    if (input.modelId && !(await workspaceChatModels(authorization.tenantId)).models.has(input.modelId)) return reply.code(400).send(modelUnavailable);
    return reply.code(201).send({ run: serializeEvaluationRun(await dependencies.runEvaluation.execute({ tenantId: authorization.tenantId, ...input })) });
  });
  app.post("/v1/admin/evaluation-workflows", { config: { rateLimit: { max: 2 } } }, async (request,reply) => {
    const owner = await authorizeOwner(request,true); if (!owner.ok) return rejectScope(reply,owner);
    if (!request.headers['x-workspace-id']) return reply.code(400).send({code:'workspace_required',error:'Select a workspace.'});
    if (!dependencies.workflows) return reply.code(503).send({error:'Durable evaluations are not enabled.'});
    return reply.code(202).send({workflow:serializeWorkflow(await dependencies.workflows.startEvaluation(owner.tenantId,owner.userId,evaluationInput.parse(request.body ?? {})))});
  });
  app.post("/v1/admin/evaluation-workflows/:runId/:action", async (request,reply) => {
    const owner = await authorizeOwner(request,true); if (!owner.ok) return rejectScope(reply,owner);
    if (!request.headers['x-workspace-id']) return reply.code(400).send({code:'workspace_required',error:'Select a workspace.'});
    const {runId,action} = z.strictObject({runId:z.string().uuid(),action:z.enum(['approve','cancel'])}).parse(request.params);
    if (!dependencies.workflows) return reply.code(503).send({error:'Durable evaluations are not enabled.'});
    const runs = await dependencies.workflows.repository.list(owner.tenantId,'evaluation',50);
    const run = runs.find((item)=>item.runId===runId); if (!run) return reply.code(404).send({error:'Evaluation not found.'});
    const scope = {tenantId:owner.tenantId,actorId:run.actorId,runId};
    const changed = action === 'approve' ? await dependencies.workflows.approve(scope,owner.userId) : await dependencies.workflows.cancel(scope);
    if (!changed) return reply.code(409).send({error:'This evaluation has already changed. Refresh to see its status.'});
    await dependencies.recordAuditEvent({tenantId:owner.tenantId,actorUserId:owner.userId,action:`workflow.${action}`,resourceType:'evaluation',resourceId:runId,requestId:request.id,metadata:{}});
    return {workflow:serializeWorkflow((await dependencies.workflows.repository.get(scope))!)};
  });
  app.post("/v1/admin/uploads/:jobId/cancel", async (request,reply) => {
    const admin = await authorizeAdmin(request); if (!admin.ok) return rejectScope(reply,admin);
    const {jobId}=z.strictObject({jobId:z.string().uuid()}).parse(request.params);
    if (!dependencies.cancelIngestion) return reply.code(503).send({error:'Cancellation is unavailable.'});
    if (!await dependencies.cancelIngestion(admin.tenantId,jobId)) return reply.code(409).send({error:'This document is no longer processing.'});
    await dependencies.recordAuditEvent({tenantId:admin.tenantId,actorUserId:admin.userId,action:'ingestion.cancelled',resourceType:'ingestion_job',resourceId:jobId,requestId:request.id,metadata:{}});
    return {jobId,status:'cancelled'};
  });
  app.post("/v1/admin/uploads/:jobId/retry", async (request, reply) => {
    const authorization = await authorizeAdmin(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    try {
      await dependencies.retryIngestionJob.execute(jobId, authorization.tenantId);
      await dependencies.recordAuditEvent({
        tenantId: authorization.tenantId,
        actorUserId: authorization.userId,
        action: "ingestion.retry_queued",
        resourceType: "ingestion_job",
        resourceId: jobId,
        requestId: request.id,
        metadata: {}
      });
      return reply.code(202).send({ jobId, status: "queued" });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Unable to retry ingestion job." });
    }
  });
  app.get("/v1/admin/documents", async (request, reply) => {
    const authorization = await authorizeMember(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const filters = documentFiltersSchema.parse(request.query);
    return { documents: (await dependencies.listDocuments(authorization.tenantId, 100, filters)).map(serializeDocument) };
  });
  app.get("/v1/admin/documents/:documentId/chunks", async (request, reply) => {
    const authorization = await authorizeMember(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(request.params);
    return { chunks: (await dependencies.listDocumentChunks(authorization.tenantId, documentId, 200)).map(serializeStoredChunk) };
  });
  app.get("/v1/admin/documents/:documentId/original", { exposeHeadRoute: false }, async (request, reply) => {
    const authorization = await authorizeMember(request, true);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(request.params);
    const original = await dependencies.getDocumentOriginal.execute({ tenantId: authorization.tenantId, documentId });
    if (!original) return reply.code(404).send({ error: "Original file not available." });

    await dependencies.recordAuditEvent({
      tenantId: authorization.tenantId,
      actorUserId: authorization.userId,
      action: "document.original_read",
      resourceType: "document",
      resourceId: documentId,
      requestId: request.id,
      metadata: {}
    });
    const isPdf = (original.mimeType === "application/pdf" || /\.pdf$/i.test(original.filename))
      && original.payload.toString("utf8", 0, 5) === "%PDF-";
    return reply
      .type(isPdf ? "application/pdf" : "application/octet-stream")
      .header("content-disposition", originalFileDisposition(original.filename))
      .header("access-control-expose-headers", "content-disposition")
      .send(original.payload);
  });
  app.post("/v1/admin/documents/:documentId/reindex", async (request, reply) => {
    const authorization = await authorizeAdmin(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(request.params);
    const job = await dependencies.reindexDocument.execute({ documentId, tenantId: authorization.tenantId });
    if (!job) return reply.code(409).send({ error: "This document has no stored original available for reindexing." });
    await dependencies.recordAuditEvent({
      tenantId: authorization.tenantId,
      actorUserId: authorization.userId,
      action: "document.reindex_queued",
      resourceType: "ingestion_job",
      resourceId: job.id,
      requestId: request.id,
      metadata: { documentId }
    });
    return reply.code(202).send({ job: serializeJob(job) });
  });
  app.delete("/v1/admin/documents/:documentId", async (request, reply) => {
    const authorization = await authorizeAdmin(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(request.params);
    const deleted = await dependencies.deleteDocument.execute({ documentId, tenantId: authorization.tenantId });
    if (!deleted) return reply.code(404).send({ error: "Document not found." });
    await dependencies.invalidateSemanticCache(authorization.tenantId);
    await dependencies.recordAuditEvent({
      tenantId: authorization.tenantId,
      actorUserId: authorization.userId,
      action: "document.deleted",
      resourceType: "document",
      resourceId: documentId,
      requestId: request.id,
      metadata: {}
    });
    return reply.code(204).send();
  });
  app.post("/v1/documents", async (request, reply) => {
    if (config.DEMO_MODE) {
      const providedAdminKey = request.headers["x-admin-api-key"];
      const adminKey = typeof providedAdminKey === "string" ? providedAdminKey : undefined;
      if (!matchesApiKey(adminKey, config.ADMIN_API_KEY as string)) return reply.code(401).send({ error: "Unauthorized" });
    }
    const input = documentInputSchema.parse(request.body);
    const textBytes = Buffer.byteLength(input.text, "utf8");
    const quota = await dependencies.consumeAdminUploadQuota(config.DEFAULT_TENANT_ID, "api-key", textBytes);
    if (!quota.allowed) return reply.code(429).send({ error: "Daily upload quota reached. Try again tomorrow." });
    // Only the upload worker can associate an indexed revision with an original.
    const metadata = { ...input.metadata };
    delete metadata.ingestionJobId;
    const result = await dependencies.ingestDocument.execute({ ...input, metadata, tenantId: config.DEFAULT_TENANT_ID });
    await dependencies.recordAuditEvent({
      tenantId: config.DEFAULT_TENANT_ID,
      actorUserId: null,
      action: "document.ingested_via_api",
      resourceType: "document",
      resourceId: result.id,
      requestId: request.id,
      metadata: { bytes: textBytes }
    });
    if (result.highRiskChunks > 0) {
      request.log.warn({ documentId: result.id, highRiskChunks: result.highRiskChunks }, "High-risk chunks excluded from Q&A context");
    }
    return reply.code(201).send({ documentId: result.id, chunkCount: result.chunkCount, highRiskChunks: result.highRiskChunks });
  });
  app.get("/v1/search", async (request, reply) => {
    const { q, topK } = searchSchema.parse(request.query);
    const scope = await resolveQueryScope(request);
    if (!scope.ok) return rejectScope(reply, scope);
    const results = await dependencies.searchDocuments.execute({ query: q, topK, tenantId: scope.tenantId });
    return { results: results.map(({ content, ...result }) => {
      const { excerpt, excerptTruncated, previewBlocked } = restrictedPassagePreview(content, result.security);
      return { ...result, content: excerpt, previewTruncated: excerptTruncated, previewBlocked };
    }) };
  });
  app.get("/v1/qa/models", { exposeHeadRoute: false }, async (request, reply) => {
    const membership = await authorizeMember(request, true);
    if (!membership.ok) return rejectScope(reply, membership);
    const profile = await workspaceChatModels(membership.tenantId);
    const models = Array.from(profile.models.values(), ({ descriptor }) => descriptor);
    if (models.length === 0) return reply.code(503).send(modelUnavailable);
    return { models, comparisonAvailable: models.length >= 2, promptComparisonAvailable: true, promptVariants: chatPromptDescriptors, ...(profile.auto ? { autoAvailable: true } : {}) };
  });
  app.post("/v1/qa/compare", { config: { rateLimit: { max: config.QA_RATE_LIMIT_MAX } } }, async (request, reply) => {
    const { question, topK, modelIds, promptVariantIds } = questionComparisonInputSchema.parse(request.body);
    const membership = await authorizeMember(request, true);
    if (!membership.ok) return rejectScope(reply, membership);
    const profile = await workspaceChatModels(membership.tenantId);
    const [left, right] = modelIds.map((id) => profile.models.get(id));
    if (!left || !right) return reply.code(400).send(modelUnavailable);
    const { tenantId, userId } = membership;
    const actorKey = `user:${userId}`;
    const quota = await dependencies.consumeQuestionQuota(tenantId, actorKey, 2);
    if (!quota.allowed) return reply.code(429).send({ error: "Daily question quota reached. Try again tomorrow." });
    return withReplySignal(reply, streamShutdown.signal, async (signal) => {
      const results = await dependencies.compareAnswers.execute({ question, topK, tenantId, actorKey, models: [left, right], promptVariantIds, signal });
      return { results: results.map(({ model, response, ...result }) => ({
        ...result, model, response: response ? serializeQuestionAnswer(response, model) : null
      })) };
    });
  });
  app.post("/v1/qa", { config: { rateLimit: { max: config.QA_RATE_LIMIT_MAX } } }, async (request, reply) => {
    const { question, topK, modelId, previousQuestions } = questionInputSchema.parse(request.body);
    const scope = await resolveQueryScope(request, modelId !== undefined || previousQuestions !== undefined);
    if (!scope.ok) return rejectScope(reply, scope);
    const answer = await chooseAnswer(scope.authenticated ? scope.tenantId : undefined, modelId);
    if (!answer) return reply.code(modelId ? 400 : 503).send(modelUnavailable);
    const { tenantId, actorKey } = scope;
    const quota = await dependencies.consumeQuestionQuota(tenantId, actorKey);
    if (!quota.allowed) return reply.code(429).send({ error: "Daily question quota reached. Try again tomorrow." });
    return withReplySignal(reply, streamShutdown.signal, async (signal) =>
      serializeQuestionAnswer(await answer({ question, ...(previousQuestions ? { previousQuestions } : {}), topK, tenantId, actorKey, signal })));
  });
  app.post("/v1/qa/stream", { config: { rateLimit: { max: config.QA_RATE_LIMIT_MAX } } }, async (request, reply) => {
    const { question, topK, runId, modelId, previousQuestions } = questionStreamInputSchema.parse(request.body);
    const turn = { question, ...(previousQuestions ? { previousQuestions } : {}), topK };
    if (runId) {
      const membership = await authorizeMember(request, true);
      if (!membership.ok) return rejectScope(reply, membership);
      const answer = await chooseAnswer(membership.tenantId, modelId);
      if (!answer) return reply.code(modelId ? 400 : 503).send(modelUnavailable);
      const { tenantId, userId } = membership;
      const actorKey = `user:${userId}`;
      const scope = { runId, tenantId, actorId: userId };
      if (dependencies.workflows) {
        await dependencies.workflows.startChat(scope,{...turn,modelId});
        return replayAnswerStream(request,reply,dependencies.chatRuns,scope,0,streamShutdown.signal);
      }
      await answerRuns.start(scope, {
        reserveQuota: async () => (await dependencies.consumeQuestionQuota(tenantId, actorKey)).allowed,
        answer: async ({ signal, publish }) => serializeQuestionAnswer(await answer({
          ...turn, tenantId, actorKey, signal,
          onEvent: (event) => publish(serializeWorkflowEvent(event))
        })),
        reportFailure: (error) => request.log.warn({ errorType: error instanceof Error ? error.name : typeof error, runId }, "Answer run execution failed")
      });
      return replayAnswerStream(request, reply, dependencies.chatRuns, scope, 0, streamShutdown.signal);
    }

    const scope = await resolveQueryScope(request, modelId !== undefined || previousQuestions !== undefined);
    if (!scope.ok) return rejectScope(reply, scope);
    const answer = await chooseAnswer(scope.authenticated ? scope.tenantId : undefined, modelId);
    if (!answer) return reply.code(modelId ? 400 : 503).send(modelUnavailable);
    const { tenantId, actorKey } = scope;
    const quota = await dependencies.consumeQuestionQuota(tenantId, actorKey);
    if (!quota.allowed) return reply.code(429).send({ error: "Daily question quota reached. Try again tomorrow." });

    const stream = openAnswerStream(request, reply, streamShutdown.signal);
    try {
      await stream.event("accepted", { status: "accepted" });
      const result = await answer({
        ...turn, tenantId, actorKey, signal: stream.signal,
        onEvent: (event) => {
          const serialized = serializeWorkflowEvent(event);
          return stream.event(serialized.type, "sources" in serialized || "delta" in serialized ? serialized : { status: serialized.type });
        }
      });
      await stream.event("completed", serializeQuestionAnswer(result));
    } catch (error) {
      if (!stream.signal.aborted) {
        request.log.warn({ errorType: error instanceof Error ? error.name : typeof error }, "Transient answer stream failed");
        await stream.event("error", { error: "Lumora could not prepare an answer. Try again." }).catch(() => undefined);
      }
    } finally {
      stream.close();
    }
  });
  app.get("/v1/qa/runs/:runId/events", { exposeHeadRoute: false }, async (request, reply) => {
    const { runId } = chatRunParams.parse(request.params);
    const { after } = chatRunCursor.parse(request.query);
    const membership = await authorizeMember(request, true);
    if (!membership.ok) return rejectScope(reply, membership);
    const scope = { runId, tenantId: membership.tenantId, actorId: membership.userId };
    return replayAnswerStream(request, reply, dependencies.chatRuns, scope, after, streamShutdown.signal);
  });
  app.post("/v1/qa/runs/:runId/cancel", async (request, reply) => {
    const { runId } = chatRunParams.parse(request.params);
    const membership = await authorizeMember(request, true);
    if (!membership.ok) return rejectScope(reply, membership);
    const scope = {runId,tenantId:membership.tenantId,actorId:membership.userId};
    await dependencies.workflows?.cancel(scope);
    const status = await answerRuns.cancel(scope);
    if (!status) return reply.code(404).send({ error: "This answer session is no longer available." });
    return { status };
  });
  return app;
}

function serializeJob(job: Omit<IngestionJob, "payload"> | IngestionJob) {
  return { id: job.id, source: job.source, title: job.title, filename: job.filename, mimeType: job.mimeType, status: job.status, progress: job.progress, error: job.error, chunkCount: job.chunkCount, highRiskChunks: job.highRiskChunks, createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString() };
}

function serializeIngestionEvent(event: IngestionJobEvent) {
  return { id: event.id, stage: event.stage, status: event.status, durationMs: event.durationMs, details: event.details, createdAt: event.createdAt.toISOString() };
}

function serializeDocument(document: ManagedDocument) {
  return {
    id: document.id, source: document.source, title: document.title, chunkCount: document.chunkCount, hasOriginal: document.hasOriginal,
    format: document.format, language: document.language, sectionCount: document.sectionCount,
    createdAt: document.createdAt.toISOString(), updatedAt: document.updatedAt.toISOString()
  };
}

function serializeEvaluationRun(run: EvaluationRun) {
  return { ...run, createdAt: run.createdAt.toISOString() };
}

function serializeStoredChunk(chunk: StoredChunk) {
  return { id: chunk.id, ordinal: chunk.ordinal, content: chunk.content, security: chunk.security, createdAt: chunk.createdAt.toISOString() };
}

function passageExcerpt(content: string) {
  const safeText = redactPii(content).text;
  const excerpt = safeText.slice(0, maxPassageExcerptChars).replace(/[\uD800-\uDBFF]$/u, "");
  return { excerpt, excerptTruncated: excerpt.length < safeText.length };
}

function restrictedPassagePreview(content: string, security: PromptInjectionAssessment) {
  return isSafeForAnswer(security)
    ? { ...passageExcerpt(content), previewBlocked: false }
    : { excerpt: "", excerptTruncated: false, previewBlocked: true };
}

function serializeAnswerSource({ chunkId, documentId, source, title, ordinal, score, content }: AnswerQuestionResult["sources"][number]) {
  return { chunkId, documentId, source, title, chunk: ordinal, score, ...passageExcerpt(content) };
}

function serializeQuestionAnswer(result: AnswerQuestionResult, model = result.model) {
  return publicAnswerResponse(result,model);
}

function serializeWorkflowEvent(event: AnswerWorkflowEvent): ChatRunEvent { return publicWorkflowEvent(event); }

function serializeWorkflow(run:WorkflowSnapshot) {
  return {runId:run.runId,kind:run.kind,version:run.version,status:run.status,stage:run.stage,steps:run.steps,calls:run.calls,inputTokens:run.inputTokens,outputTokens:run.outputTokens,costMicros:run.costMicros,budget:run.budget,attempts:run.attempts,errorCode:run.errorCode,resultId:run.resultId,createdAt:run.createdAt.toISOString(),updatedAt:run.updatedAt.toISOString(),expiresAt:run.expiresAt.toISOString()};
}
