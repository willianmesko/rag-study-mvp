import { evaluationRoutes } from "../modules/evaluations/evaluations.controller.js";
import { operationsRoutes } from "../modules/usage/operations.controller.js";
import { searchRoutes } from "../modules/knowledge/search.controller.js";
import { chatModelRoutes } from "../modules/chat/chat-models.controller.js";
import { chatRoutes } from "../modules/chat/chat.controller.js";
import { createChatModelSelection } from "../modules/chat/http/chat-models.js";
import { createChatDelivery } from "../modules/chat/http/chat-delivery.js";
import { createQueryScopeResolver } from "../platform/http/query-scope.js";
import { ingestionRoutes } from "../modules/ingestion/ingestion.controller.js";
import { matchesApiKey } from "../platform/http/api-key.js";
import { InvitationDeliveryError } from '../modules/workspaces/application/integrations/workspace-invitations.js';
import {UploadAdmissionError} from "../modules/ingestion/application/ports/ingestion-job-repository.js";
import { DeliveryCommandError } from "../modules/usage/index.js";
import { WorkflowGuardError, WorkflowApprovalPending } from "../platform/workflows/types.js";
import {withCorrelation} from "../platform/observability/observer.js";
import {openHttpSpan} from "./observability/telemetry.js";
import { createHmac, randomUUID } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyRequest } from "fastify";
import { MemberDirectoryError } from "../modules/identity/application/ports/identity-verifier.js";
import { createIdentityServices } from "./composition/identity.js";
import type { HttpDependencies } from "./http-dependencies.js";
import { createWorkspaceAuthorization, identityFailure } from "../platform/http/workspace-authorization.js";
import { workspaceRoutes } from "../modules/workspaces/workspaces.controller.js";
import { workspaceTeamRoutes } from "../modules/workspaces/workspace-team.controller.js";
import { documentRoutes } from "../modules/knowledge/documents.controller.js";
import { serializeJob } from "../modules/ingestion/http/ingestion.js";
import { RequestIdentity } from "../modules/identity/http/request-identity.js";
import { ZodError } from "zod";
import { AutoAnswerFailedError } from "../modules/chat/application/use-cases/route-answer.js";
import { EmbeddingIndexChangedError } from "../modules/ai/application/ports/workspace-embedding-index.js";
import { ChatBudgetExceededError } from "../modules/ai/application/policies/chat-cost.js";
import { StreamAnswerRuns } from "../modules/chat/application/use-cases/stream-answer-runs.js";
import { EvaluationRunError } from "../modules/evaluations/application/use-cases/run-evaluation.js";
import { config as defaultConfiguration } from "../config.js";
import type { RuntimeConfiguration } from "./configuration/environment.js";
import { registerWorkspaceMcpRoutes } from "../modules/mcp/workspace-mcp.controller.js";
import { registerAgentActionRoutes } from "../modules/mcp/agent-actions.controller.js";
import { safeHttpLogSerializers } from "../platform/http/safe-logging.js";
import { frameworkRequestFailure } from "../platform/http/request-errors.js";
import { isRemoteMcpPath, registerMcpOAuthRoutes } from "../modules/mcp/mcp-oauth.controller.js";
import { registerRemoteMcp } from "../modules/mcp/infrastructure/remote.js";
import { ConversationError } from "../modules/chat/application/ports/conversation-repository.js";
import { registerConversationRoutes } from "../modules/chat/conversations.controller.js";





export type HttpConfiguration = Pick<RuntimeConfiguration,
  "ADMIN_API_KEY" | "AGENT_TIMEOUT_MS" | "ALLOWED_ORIGINS" | "API_KEY" |
  "APP_BASE_URL" | "DEFAULT_TENANT_ID" | "DEMO_MODE" | "MCP_REMOTE_ALLOWED_ORIGINS" |
  "PDF_OCR_ENABLED" | "PROVIDER_TIMEOUT_MS" | "QA_RATE_LIMIT_MAX" | "RATE_LIMIT_MAX" |
  "RATE_LIMIT_WINDOW_MS" | "SUPABASE_PUBLISHABLE_KEY" | "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_URL" |
  "UPLOAD_MAX_BYTES" | "USAGE_ALERT_THRESHOLD_USD" | "USAGE_HASH_SECRET"
>;

function applyCorsHeaders(config: HttpConfiguration, origin: string | undefined, reply: { header: (name: string, value: string) => unknown }, remote = false): boolean {
  if (!origin) return true;
  const allowed = remote ? [...config.ALLOWED_ORIGINS, ...config.MCP_REMOTE_ALLOWED_ORIGINS, ...(config.APP_BASE_URL ? [new URL(config.APP_BASE_URL).origin] : [])] : config.ALLOWED_ORIGINS;
  if (!allowed.includes(origin)) return false;
  reply.header("access-control-allow-origin", origin);
  reply.header("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  reply.header("access-control-allow-headers", "authorization, content-type, idempotency-key, x-document-source, x-document-title, x-workspace-id, mcp-protocol-version, mcp-session-id, last-event-id");
  reply.header("access-control-expose-headers", "www-authenticate, mcp-protocol-version, mcp-session-id, x-request-id");
  reply.header("access-control-max-age", "600");
  reply.header("vary", "Origin");
  return true;
}

function anonymousActorKey(config: HttpConfiguration, request: { headers: Record<string, string | string[] | undefined>; ip?: string }): string {
  // Do not trust a client-supplied X-Forwarded-For value for quota identity.
  // Render/Fastify can be configured with a trusted proxy separately when a
  // production deployment needs the original address.
  const source = request.ip ?? "unknown";
  const secret = config.USAGE_HASH_SECRET ?? config.SUPABASE_SERVICE_ROLE_KEY ?? config.ADMIN_API_KEY ?? "local-development-only-not-for-production";
  return `anonymous:${createHmac("sha256", secret).update(source).digest("hex").slice(0, 32)}`;
}

export async function buildApp(dependencies: HttpDependencies, options: {
  configuration?: HttpConfiguration;
  isProduction?: boolean;
} = {}) {
  const config = options.configuration ?? defaultConfiguration;
  const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";
  const app = Fastify({ genReqId:()=>randomUUID(), logger: { serializers: safeHttpLogSerializers }, bodyLimit: config.UPLOAD_MAX_BYTES + 100_000 });
  const identityServices = dependencies.identityVerifier && dependencies.memberDirectory
    ? { identityVerifier: dependencies.identityVerifier, memberDirectory: dependencies.memberDirectory }
    : createIdentityServices({
    url: config.SUPABASE_URL, publishableKey: config.SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY, timeoutMs: Math.min(config.PROVIDER_TIMEOUT_MS, 10_000),
  });
  const requestIdentity = new RequestIdentity(dependencies.identityVerifier ?? identityServices.identityVerifier);
  const memberDirectory = dependencies.memberDirectory ?? identityServices.memberDirectory;
  const requestSpans=new WeakMap<FastifyRequest,ReturnType<typeof openHttpSpan>>();
  app.addHook('onRequest',(request,reply,done)=>{reply.header('x-request-id',request.id);reply.raw.setHeader('x-request-id',request.id);const span=openHttpSpan(request.method,request.routeOptions.url??'unmatched',request.id);requestSpans.set(request,span);reply.raw.once('finish',()=>span.end(reply.raw.statusCode));reply.raw.once('close',()=>span.end(reply.raw.writableFinished?reply.raw.statusCode:499));withCorrelation(request.id,()=>span.run(done));});
  app.addHook('onResponse',async(request,reply)=>{requestSpans.get(request)?.end(reply.statusCode);});
  const streamShutdown = new AbortController();
  const answerRuns = new StreamAnswerRuns(dependencies.chatRuns, config.AGENT_TIMEOUT_MS);
  app.addHook("preClose", async () => { streamShutdown.abort(); });
  app.addHook("onClose", async () => { await dependencies.workflows?.close(); await answerRuns.close(); });
  app.addHook("onReady", async () => { dependencies.workflows?.start(); });
  await app.register(multipart, { limits: { files: 1, fileSize: config.UPLOAD_MAX_BYTES, fields: 0 } });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    errorResponseBuilder: (_request, context) => ({ statusCode: context.statusCode, code: "rate_limit_exceeded", error: "Too many requests. Try again later." })
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
    const path = request.raw.url?.split("?")[0] ?? "";
    const remote = Boolean(dependencies.remoteMcp && isRemoteMcpPath(path));
    if (remote && request.headers.host !== new URL(dependencies.remoteMcp!.oauth.resource).host)
      return reply.code(403).send({ error: "Untrusted MCP host." });
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
    const originAllowed = applyCorsHeaders(config, origin, reply, remote);
    if (!originAllowed) return reply.code(403).send({ error: "Origin not allowed" });
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
    const providedApiKey = request.headers["x-api-key"];
    const apiKey = typeof providedApiKey === "string" ? providedApiKey : undefined;
    if (!remote && config.API_KEY && !matchesApiKey(apiKey, config.API_KEY)) return reply.code(401).send({ error: "Unauthorized" });
  });
  app.setErrorHandler((error, _request, reply) => {
    const frameworkFailure = frameworkRequestFailure(error);
    if (frameworkFailure) return reply.code(frameworkFailure.status).send(frameworkFailure.body);
    if (error instanceof MemberDirectoryError) {
      const status = { not_configured: 503, unavailable: 502, timeout: 504, cancelled: 503 }[error.reason];
      return reply.code(status).send({ code: "directory_unavailable", error: error.reason === "not_configured" ? "Member management is not configured." : "Unable to load workspace members." });
    }
    if(error instanceof InvitationDeliveryError)return reply.code(error.code==='forbidden'?403:409).send({code:error.code,error:error.message});
    if(error instanceof DeliveryCommandError)return reply.code({forbidden:403,not_found:404,stale_state:409}[error.code]).send({code:error.code,error:error.message});
    if (error instanceof UploadAdmissionError) return reply.code(error.code==='idempotency_conflict'?409:429).send({code:error.code,error:error.message});
    if (error instanceof ConversationError) return reply.code(error.status).send({code:error.code,error:error.message});
    if (error instanceof WorkflowApprovalPending) return reply.code(409).send({code:'approval_required',error:error.message});
    if (error instanceof WorkflowGuardError) {
      const status = { effect_outcome_unknown:409,budget_exceeded:422,lease_lost:409,cancelled:409,deadline_exceeded:504,authorization_revoked:403,definition_changed:409,state_limit:422,queue_full:429 }[error.code];
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
    app.log.error({ code: "request_failed", err: error }, "Request failed");
    return reply.code(500).send({ error: "Internal server error" });
  });
  app.get("/health", async () => ({ status: "ok", capabilities: { pdfOcr: config.PDF_OCR_ENABLED, durableWorkflows: Boolean(dependencies.workflows), durableConversations: Boolean(dependencies.conversations) } }));
  const { member: authorizeMember, admin: authorizeAdmin, owner: authorizeOwner, user: authorizeWorkspaceUser } = createWorkspaceAuthorization({
    identity: requestIdentity,
    isConfigured: () => Boolean(config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY),
    findMembership: dependencies.findMembership,
    listMemberships: dependencies.listMemberships,
  });
  if (dependencies.workspaceMcp) {
    registerWorkspaceMcpRoutes(app, {
      ...dependencies.workspaceMcp, authorize: (request) => authorizeMember(request, true),
      audit: dependencies.recordAuditEvent, shutdown: streamShutdown.signal
    });
  }
  if (dependencies.remoteMcp) {
    const authorizeUser = async (request: FastifyRequest) => {
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer ") || authorization.startsWith("Bearer lumora_") || !config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY)
        return { ok: false as const, status: 401, error: "Sign in to manage assistant connections." };
      const identity = await requestIdentity.verify(request);
      if (!identity.ok) return identityFailure(identity, { invalidError: "Sign in to manage assistant connections.", invalidStatus: 401, notConfiguredError: "Sign in to manage assistant connections." });
      return identity;
    };
    const authorize = async (request: FastifyRequest) => {
      if (request.headers.authorization?.startsWith("Bearer lumora_")) return { ok: false as const, status: 401, error: "Sign in to manage assistant connections." };
      return authorizeMember(request, true);
    };
    registerMcpOAuthRoutes(app, { ...dependencies.remoteMcp, authorize, authorizeUser, audit: dependencies.recordAuditEvent });
    registerRemoteMcp(app, { ...dependencies.remoteMcp, audit: dependencies.recordAuditEvent, shutdown: streamShutdown.signal });
  }
  if (dependencies.agentActions) {
    registerAgentActionRoutes(app, dependencies.agentActions, (request) => authorizeMember(request, true));
  }
  const resolveQueryScope = createQueryScopeResolver({
    authorizeMember,
    requiresProductionAuth: () => isProduction && !config.DEMO_MODE && !config.API_KEY,
    anonymousScope: (request) => ({ tenantId: config.DEFAULT_TENANT_ID, actorKey: anonymousActorKey(config, request) }),
  });
  const modelSelection = createChatModelSelection({
    models: dependencies.chatModels ?? new Map(), policies: dependencies.workspaceModelPolicies,
    answerQuestion: dependencies.answerQuestion, routeAnswer: dependencies.routeAnswer,
    consumeQuestionQuota: dependencies.consumeQuestionQuota,
  });
  const conversationDelivery = createChatDelivery({
    conversations: dependencies.conversations, chatRuns: dependencies.chatRuns,
    workflows: dependencies.workflows, compareAnswers: dependencies.compareAnswers,
    consumeQuestionQuota: dependencies.consumeQuestionQuota,
    answerRuns, models: modelSelection, shutdown: streamShutdown.signal, timeoutMs: config.AGENT_TIMEOUT_MS,
    report: (code, message) => app.log.warn({code}, message),
  });
  if(dependencies.conversations&&conversationDelivery)registerConversationRoutes(app,{
    records:dependencies.conversations,delivery:conversationDelivery,authorize:(request)=>authorizeMember(request,true),shutdown:streamShutdown.signal,audit:dependencies.recordAuditEvent,
    cancel:async(scope)=>{await dependencies.workflows?.cancel(scope);return answerRuns.cancel(scope);}
  });
  let alertWork:Promise<void>|undefined,alertTimer:ReturnType<typeof setInterval>|undefined;
  app.addHook('onReady',async()=>{if(!dependencies.budgetAlerts?.configured)return;alertTimer=setInterval(()=>{if(alertWork)return;alertWork=dependencies.budgetAlerts!.work().catch(()=>app.log.warn({code:'budget_alert_worker_failed'},'Budget notification check failed')).finally(()=>{alertWork=undefined;});},15000);alertTimer.unref();});
  app.addHook('preClose',async()=>{if(alertTimer)clearInterval(alertTimer);await alertWork;});
  app.register(workspaceRoutes, {
    authorizeUser: authorizeWorkspaceUser, authorizeMember,
    listMemberships: dependencies.listMemberships,
    createWorkspace: dependencies.createWorkspace,
    workspaceOnboarding: dependencies.workspaceOnboarding,
  });
  app.register(workspaceTeamRoutes, {
    authorizeOwner, memberDirectory,
    listWorkspaceMembers: dependencies.listWorkspaceMembers,
    changeWorkspaceMemberRole: dependencies.changeWorkspaceMemberRole,
    removeWorkspaceMember: dependencies.removeWorkspaceMember,
    inviteWorkspaceMember: dependencies.inviteWorkspaceMember,
    listInvitationDeliveries: dependencies.listInvitationDeliveries,
    isMemberDirectoryConfigured: () => Boolean(config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY),
    isInvitationConfigured: () => Boolean(config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY && config.APP_BASE_URL),
    shutdown: streamShutdown.signal,
  });
  app.register(documentRoutes, {
    authorizeMember, authorizeAdmin,
    listDocuments: dependencies.listDocuments,
    listDocumentChunks: dependencies.listDocumentChunks,
    getDocumentOriginal: dependencies.getDocumentOriginal,
    reindexDocument: dependencies.reindexDocument,
    serializeReindexJob: serializeJob,
    deleteDocument: dependencies.deleteDocument,
    invalidateSemanticCache: dependencies.invalidateSemanticCache,
    recordAuditEvent: dependencies.recordAuditEvent,
  });
  app.register(ingestionRoutes, {
    authorizeMember, authorizeAdmin,
    queueDocumentUpload: dependencies.queueDocumentUpload,
    ingestDocument: dependencies.ingestDocument,
    publicHtmlFetcher: dependencies.publicHtmlFetcher,
    demoLibraryRepository: dependencies.demoLibraryRepository,
    listIngestionJobs: dependencies.listIngestionJobs,
    listIngestionEvents: dependencies.listIngestionEvents,
    previewIngestionPassages: dependencies.previewIngestionPassages,
    retryIngestionJob: dependencies.retryIngestionJob,
    cancelIngestion: dependencies.cancelIngestion,
    consumeAdminUploadQuota: dependencies.consumeAdminUploadQuota,
    recordAuditEvent: dependencies.recordAuditEvent,
    isDemoMode: () => config.DEMO_MODE,
    adminApiKey: () => config.ADMIN_API_KEY,
    defaultTenantId: () => config.DEFAULT_TENANT_ID,
  });
  app.register(operationsRoutes, {
    authorizeOwner, budgetAlerts: dependencies.budgetAlerts,
    getUsageSummary: dependencies.getUsageSummary,
    usageAlertThresholdUsd: () => config.USAGE_ALERT_THRESHOLD_USD,
  });
  app.register(evaluationRoutes, {
    authorizeOwner, models: modelSelection, workflows: dependencies.workflows,
    demoLibraryRepository: dependencies.demoLibraryRepository,
    listEvaluationRuns: dependencies.listEvaluationRuns,
    runEvaluation: dependencies.runEvaluation,
    recordAuditEvent: dependencies.recordAuditEvent,
  });
  app.register(searchRoutes, {
    resolveQueryScope, knowledgeStatus: dependencies.knowledgeStatus,
    searchDocuments: dependencies.searchDocuments, shutdown: streamShutdown.signal,
  });
  app.register(chatModelRoutes, {
    authorizeMember, authorizeOwner, models: modelSelection,
    workspaceModelPolicies: dependencies.workspaceModelPolicies,
    recordAuditEvent: dependencies.recordAuditEvent,
  });
  app.register(chatRoutes, {
    authorizeMember, resolveQueryScope, models: modelSelection,
    compareAnswers: dependencies.compareAnswers, consumeQuestionQuota: dependencies.consumeQuestionQuota,
    conversations: dependencies.conversations, chatRuns: dependencies.chatRuns,
    workflows: dependencies.workflows, answerRuns, conversationDelivery,
    shutdown: streamShutdown.signal, questionRateLimitMax: config.QA_RATE_LIMIT_MAX,
  });
  return app;
}
