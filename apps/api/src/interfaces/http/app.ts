import { createHmac, timingSafeEqual } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyRequest } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { documentInputSchema, questionInputSchema, workspaceMemberRoleSchema } from "@rag-study/contracts";
import { ZodError, z } from "zod";
import type { AnswerQuestionUseCase } from "../../application/use-cases/answer-question.js";
import type { AnswerWorkflowEvent } from "../../application/ports/question-answering-workflow.js";
import type { IngestDocumentUseCase } from "../../application/use-cases/ingest-document.js";
import type { SearchDocumentsUseCase } from "../../application/use-cases/search-documents.js";
import type { QueueDocumentUploadUseCase } from "../../application/use-cases/queue-document-upload.js";
import type { ProcessNextIngestionJobUseCase } from "../../application/use-cases/process-next-ingestion-job.js";
import type { RetryIngestionJobUseCase } from "../../application/use-cases/retry-ingestion-job.js";
import type { ReindexDocumentUseCase } from "../../application/use-cases/reindex-document.js";
import type { DeleteDocumentUseCase } from "../../application/use-cases/delete-document.js";
import type { GetDocumentOriginalUseCase } from "../../application/use-cases/get-document-original.js";
import type { IngestionJob, IngestionJobEvent } from "../../application/ports/ingestion-job-repository.js";
import type { ManagedDocument, StoredChunk } from "../../application/ports/document-repository.js";
import type { AuditEventRepository } from "../../application/ports/audit-event-repository.js";
import type { QuotaResult } from "../../application/ports/quota-repository.js";
import type { UsageSummary } from "../../application/ports/usage-metrics-repository.js";
import type { EvaluationRun } from "../../application/ports/evaluation-repository.js";
import type { RunEvaluationUseCase } from "../../application/use-cases/run-evaluation.js";
import type { TenantMembership, TenantRole, WorkspaceMember } from "../../application/ports/tenant-membership-repository.js";
import { PublicHtmlFetchError, type PublicHtmlFetchErrorCode, type PublicHtmlFetcher } from "../../application/ports/public-html-fetcher.js";
import { config } from "../../config.js";
import { redactPii } from "../../domain/security/pii-redaction.js";

const searchSchema = z.object({ q: z.string().min(1).max(5_000), topK: z.coerce.number().int().min(1).max(20).optional() });
const invitationSchema = z.object({ email: z.string().email().max(320).transform((value) => value.trim().toLowerCase()), role: workspaceMemberRoleSchema });
const memberRoleSchema = z.object({ role: workspaceMemberRoleSchema });
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
  queueDocumentUpload: QueueDocumentUploadUseCase;
  publicHtmlFetcher: PublicHtmlFetcher;
  processNextIngestionJob: ProcessNextIngestionJobUseCase;
  retryIngestionJob: RetryIngestionJobUseCase;
  listIngestionJobs: (tenantId: string, limit: number) => Promise<Omit<IngestionJob, "payload">[]>;
  listIngestionEvents: (jobId: string, tenantId: string, limit: number) => Promise<IngestionJobEvent[]>;
  findPrimaryMembership: (userId: string) => Promise<TenantMembership | null>;
  listMemberships: (userId: string) => Promise<TenantMembership[]>;
  findMembership: (userId: string, tenantId: string) => Promise<TenantMembership | null>;
  createWorkspace: (input: { userId: string; name: string; slug: string }) => Promise<TenantMembership>;
  listWorkspaceMembers: (tenantId: string) => Promise<WorkspaceMember[]>;
  addWorkspaceMember: (input: { tenantId: string; userId: string; role: Exclude<TenantRole, "owner"> }) => Promise<void>;
  changeWorkspaceMemberRole: (input: { tenantId: string; userId: string; role: Exclude<TenantRole, "owner"> }) => Promise<boolean>;
  removeWorkspaceMember: (input: { tenantId: string; userId: string }) => Promise<boolean>;
  recordWorkspaceInvitation: (input: { tenantId: string; email: string; role: Exclude<TenantRole, "owner">; invitedBy: string; invitedUserId: string }) => Promise<void>;
  listDocuments: (tenantId: string, limit: number) => Promise<ManagedDocument[]>;
  listDocumentChunks: (tenantId: string, documentId: string, limit: number) => Promise<StoredChunk[]>;
  getDocumentOriginal: Pick<GetDocumentOriginalUseCase, "execute">;
  reindexDocument: ReindexDocumentUseCase;
  deleteDocument: DeleteDocumentUseCase;
  consumeQuestionQuota: (tenantId: string, actorKey: string) => Promise<QuotaResult>;
  consumeAdminUploadQuota: (tenantId: string, actorKey: string, bytes: number) => Promise<QuotaResult>;
  getUsageSummary: (tenantId: string, days: number) => Promise<UsageSummary>;
  listEvaluationRuns: (tenantId: string, limit: number) => Promise<EvaluationRun[]>;
  runEvaluation: RunEvaluationUseCase;
  invalidateSemanticCache: (tenantId: string) => Promise<void>;
  recordAuditEvent: AuditEventRepository["record"];
};

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
  reply.header("access-control-allow-headers", "authorization, content-type, x-document-source, x-document-title, x-workspace-id");
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
  const app = Fastify({ logger: true, bodyLimit: config.UPLOAD_MAX_BYTES + 100_000 });
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
    if (error instanceof ZodError) return reply.code(400).send({ error: "Invalid request", details: error.flatten() });
    if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 429) {
      return reply.code(429).send({ error: "Too many requests. Try again later." });
    }
    app.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });
  app.get("/health", async () => ({ status: "ok", capabilities: { pdfOcr: config.PDF_OCR_ENABLED } }));
  const authorizeMember = async (request: { headers: Record<string, string | string[] | undefined> }, requireExplicitWorkspace = false) => {
    if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) return { ok: false as const, status: 503, error: "Admin upload is not configured." };
    const authorization = request.headers.authorization;
    const token = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    if (!token) return { ok: false as const, status: 401, error: "Authentication required." };
    const requestedTenant = typeof request.headers["x-workspace-id"] === "string" ? request.headers["x-workspace-id"] : undefined;
    if (requireExplicitWorkspace && !z.string().uuid().safeParse(requestedTenant).success) {
      return { ok: false as const, status: 400, error: "Select a valid workspace." };
    }
    const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return { ok: false as const, status: 403, error: "Administrator access required." };
    const membership = requestedTenant ? await dependencies.findMembership(data.user.id, requestedTenant) : await dependencies.findPrimaryMembership(data.user.id);
    if (!membership) return { ok: false as const, status: 403, error: "Workspace membership required." };
    return { ok: true as const, userId: data.user.id, tenantId: membership.tenantId, role: membership.role };
  };
  const authorizeAdmin = async (request: { headers: Record<string, string | string[] | undefined> }, requireExplicitWorkspace = false) => {
    const authorization = await authorizeMember(request, requireExplicitWorkspace);
    if (!authorization.ok) return authorization;
    if (authorization.role === "viewer") return { ok: false as const, status: 403, error: "Editor or owner access required." };
    return authorization;
  };
  const authorizeOwner = async (request: { headers: Record<string, string | string[] | undefined> }) => {
    const authorization = await authorizeMember(request);
    if (!authorization.ok) return authorization;
    if (authorization.role !== "owner") return { ok: false as const, status: 403, error: "Only the workspace owner can manage members." };
    return authorization;
  };
  async function resolveQueryScope(request: FastifyRequest) {
    if (request.headers.authorization?.startsWith("Bearer ")) {
      const membership = await authorizeMember(request);
      if (!membership.ok) return membership;
      return { ok: true as const, tenantId: membership.tenantId, actorKey: `user:${membership.userId}` };
    }

    const requestsPrivateAccess = request.headers.authorization !== undefined || request.headers["x-workspace-id"] !== undefined;
    const requiresProductionAuth = process.env.NODE_ENV === "production" && !config.DEMO_MODE && !config.API_KEY;
    if (requestsPrivateAccess || requiresProductionAuth) {
      return { ok: false as const, status: 401, error: "Authentication required." };
    }
    return { ok: true as const, tenantId: config.DEFAULT_TENANT_ID, actorKey: anonymousActorKey(request) };
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
  app.get("/v1/workspaces/:workspaceId/members", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
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
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    if (workspaceId !== authorization.tenantId) return reply.code(403).send({ error: "Select the workspace you want to manage." });
    if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY || !config.APP_BASE_URL) return reply.code(503).send({ error: "Invitations are not configured." });
    const input = invitationSchema.parse(request.body);
    const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, { redirectTo: config.APP_BASE_URL });
    if (error || !data.user) return reply.code(409).send({ error: error?.message ?? "Unable to invite this email." });
    await dependencies.addWorkspaceMember({ tenantId: authorization.tenantId, userId: data.user.id, role: input.role });
    await dependencies.recordWorkspaceInvitation({ tenantId: authorization.tenantId, email: input.email, role: input.role, invitedBy: authorization.userId, invitedUserId: data.user.id });
    await dependencies.recordAuditEvent({ tenantId: authorization.tenantId, actorUserId: authorization.userId, action: "workspace.member_invited", resourceType: "tenant_membership", resourceId: null, requestId: request.id, metadata: { role: input.role } });
    return reply.code(201).send({ member: { userId: data.user.id, email: input.email, role: input.role } });
  });
  app.patch("/v1/workspaces/:workspaceId/members/:userId", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
    const { workspaceId, userId } = z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }).parse(request.params);
    if (workspaceId !== authorization.tenantId) return reply.code(403).send({ error: "Select the workspace you want to manage." });
    const { role } = memberRoleSchema.parse(request.body);
    const updated = await dependencies.changeWorkspaceMemberRole({ tenantId: authorization.tenantId, userId, role });
    if (!updated) return reply.code(409).send({ error: "Owners cannot have their role changed." });
    return reply.code(204).send();
  });
  app.delete("/v1/workspaces/:workspaceId/members/:userId", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
    const { workspaceId, userId } = z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }).parse(request.params);
    if (workspaceId !== authorization.tenantId) return reply.code(403).send({ error: "Select the workspace you want to manage." });
    const removed = await dependencies.removeWorkspaceMember({ tenantId: authorization.tenantId, userId });
    if (!removed) return reply.code(409).send({ error: "Owners cannot be removed." });
    return reply.code(204).send();
  });
  async function queueWorkspaceUpload(
    actor: { tenantId: string; userId: string }, requestId: string,
    upload: Omit<Parameters<QueueDocumentUploadUseCase["execute"]>[0], "tenantId">,
    sourceType: "file" | "url"
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

  app.post("/v1/admin/uploads", async (request, reply) => {
    const authorization = await authorizeAdmin(request);
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
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
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
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
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
    return { jobs: (await dependencies.listIngestionJobs(authorization.tenantId, 30)).map(serializeJob) };
  });
  app.get("/v1/admin/uploads/:jobId/events", async (request, reply) => {
    const authorization = await authorizeMember(request);
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    return { events: (await dependencies.listIngestionEvents(jobId, authorization.tenantId, 100)).map(serializeIngestionEvent) };
  });
  app.get("/v1/admin/usage", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }).parse(request.query);
    const summary = await dependencies.getUsageSummary(authorization.tenantId, days);
    return { days, summary, alert: { thresholdUsd: config.USAGE_ALERT_THRESHOLD_USD, triggered: summary.estimatedCostUsd >= config.USAGE_ALERT_THRESHOLD_USD } };
  });
  app.get("/v1/admin/evaluations", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    return { runs: (await dependencies.listEvaluationRuns(authorization.tenantId, limit)).map(serializeEvaluationRun) };
  });
  app.post("/v1/admin/evaluations/run", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
    return reply.code(201).send({ run: serializeEvaluationRun(await dependencies.runEvaluation.execute({ tenantId: authorization.tenantId })) });
  });
  app.post("/v1/admin/uploads/:jobId/retry", async (request, reply) => {
    const authorization = await authorizeAdmin(request);
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
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
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
    return { documents: (await dependencies.listDocuments(authorization.tenantId, 100)).map(serializeDocument) };
  });
  app.get("/v1/admin/documents/:documentId/chunks", async (request, reply) => {
    const authorization = await authorizeMember(request);
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
    const { documentId } = z.object({ documentId: z.string().uuid() }).parse(request.params);
    return { chunks: (await dependencies.listDocumentChunks(authorization.tenantId, documentId, 200)).map(serializeStoredChunk) };
  });
  app.get("/v1/admin/documents/:documentId/original", { exposeHeadRoute: false }, async (request, reply) => {
    const authorization = await authorizeMember(request, true);
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
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
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
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
    if (!authorization.ok) return reply.code(authorization.status).send({ error: authorization.error });
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
    if (!scope.ok) return reply.code(scope.status).send({ error: scope.error });
    return { results: await dependencies.searchDocuments.execute({ query: q, topK, tenantId: scope.tenantId }) };
  });
  app.post("/v1/qa", { config: { rateLimit: { max: config.QA_RATE_LIMIT_MAX } } }, async (request, reply) => {
    const { question, topK } = questionInputSchema.parse(request.body);
    const scope = await resolveQueryScope(request);
    if (!scope.ok) return reply.code(scope.status).send({ error: scope.error });
    const { tenantId, actorKey } = scope;
    const quota = await dependencies.consumeQuestionQuota(tenantId, actorKey);
    if (!quota.allowed) return reply.code(429).send({ error: "Daily question quota reached. Try again tomorrow." });
    const result = await dependencies.answerQuestion.execute({ question, topK, tenantId, actorKey });
    return {
      answer: result.answer,
      citedChunkIds: result.citedChunkIds ?? [],
      structuredOutput: result.structuredOutput ?? false,
      refusalReason: result.refusalReason ?? null,
      sources: result.sources.map(({ chunkId, documentId, source, title, ordinal, score, content }) => ({
        chunkId,
        documentId,
        source,
        title,
        chunk: ordinal,
        score,
        excerpt: redactPii(content.slice(0, 1_200)).text
      }))
    };
  });
  app.post("/v1/qa/stream", { config: { rateLimit: { max: config.QA_RATE_LIMIT_MAX } } }, async (request, reply) => {
    const { question, topK } = questionInputSchema.parse(request.body);
    const scope = await resolveQueryScope(request);
    if (!scope.ok) return reply.code(scope.status).send({ error: scope.error });
    const { tenantId, actorKey } = scope;
    const quota = await dependencies.consumeQuestionQuota(tenantId, actorKey);
    if (!quota.allowed) return reply.code(429).send({ error: "Daily question quota reached. Try again tomorrow." });

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      ...(typeof request.headers.origin === "string" && config.ALLOWED_ORIGINS.includes(request.headers.origin) ? { "access-control-allow-origin": request.headers.origin, vary: "Origin" } : {})
    });
    let disconnected = false;
    request.raw.on("close", () => { disconnected = true; });
    const send = (event: string, data: unknown) => {
      if (!disconnected && !reply.raw.destroyed) reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send("accepted", { status: "accepted" });
    try {
      const result = await dependencies.answerQuestion.execute({
        question,
        topK,
        tenantId,
        actorKey,
        onEvent: (event: AnswerWorkflowEvent) => send(event.type, event.type === "token" ? { delta: event.delta } : { status: event.type })
      });
      send("completed", serializeQuestionAnswer(result));
    } catch (error) {
      send("error", { error: error instanceof Error ? error.message : "Unable to complete the answer." });
    } finally {
      if (!reply.raw.destroyed) reply.raw.end();
    }
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

function serializeQuestionAnswer(result: { answer: string; citedChunkIds?: string[]; structuredOutput?: boolean; refusalReason?: string; sources: Array<{ chunkId: string; documentId: string; source: string; title: string | null; ordinal: number; score: number; content: string }> }) {
  return {
    answer: result.answer,
    citedChunkIds: result.citedChunkIds ?? [],
    structuredOutput: result.structuredOutput ?? false,
    refusalReason: result.refusalReason ?? null,
    sources: result.sources.map(({ chunkId, documentId, source, title, ordinal, score, content }) => ({
      chunkId,
      documentId,
      source,
      title,
      chunk: ordinal,
      score,
      excerpt: redactPii(content.slice(0, 1_200)).text
    }))
  };
}

