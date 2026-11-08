import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { demoLibraryIdSchema, demoLocaleSchema, documentInputSchema } from "@rag-study/contracts";
import { demoLibraries } from "../knowledge/index.js";
import { ExistingIngestionSourceError, type IngestionJobRepository } from "./application/ports/ingestion-job-repository.js";
import type { DemoLibraryRepository } from "../knowledge/index.js";
import type { AuditEventRepository } from "../usage/index.js";
import type { QuotaResult } from "../usage/index.js";
import { PublicHtmlFetchError, type PublicHtmlFetchErrorCode, type PublicHtmlFetcher } from "./application/ports/public-html-fetcher.js";
import type { QueueDocumentUploadUseCase } from "./application/use-cases/queue-document-upload.js";
import type { IngestDocumentUseCase } from "./application/use-cases/ingest-document.js";
import type { RetryIngestionJobUseCase } from "./application/use-cases/retry-ingestion-job.js";
import { rejectScope, type WorkspaceAuthorizer } from "../../platform/http/workspace-authorization.js";
import { serializeJob, serializeIngestionEvent } from "./http/ingestion.js";
import { restrictedPassagePreview } from "../knowledge/index.js";
import { matchesApiKey } from "../../platform/http/api-key.js";

const urlImportSchema = z.object({ url: z.string().trim().min(1).max(1_000).url(), title: z.string().trim().min(1).max(500).optional() });
const urlImportStatus: Record<PublicHtmlFetchErrorCode, number> = {
  invalid_url: 400, unsafe_destination: 400, dns_failed: 502, redirect_limit: 502,
  fetch_failed: 502, unsupported_content_type: 415, response_too_large: 413, invalid_encoding: 415, fetch_timeout: 504,
};

export type IngestionRoutesDependencies = {
  authorizeMember: WorkspaceAuthorizer;
  authorizeAdmin: WorkspaceAuthorizer;
  queueDocumentUpload: Pick<QueueDocumentUploadUseCase, "execute">;
  ingestDocument: Pick<IngestDocumentUseCase, "execute">;
  publicHtmlFetcher: PublicHtmlFetcher;
  demoLibraryRepository?: Pick<DemoLibraryRepository, "sourceStates">;
  listIngestionJobs: IngestionJobRepository["list"];
  listIngestionEvents: IngestionJobRepository["listEvents"];
  previewIngestionPassages: IngestionJobRepository["previewPassages"];
  retryIngestionJob: Pick<RetryIngestionJobUseCase, "execute">;
  cancelIngestion?: (tenantId: string, jobId: string) => Promise<boolean>;
  consumeAdminUploadQuota: (tenantId: string, actorKey: string, bytes: number) => Promise<QuotaResult>;
  recordAuditEvent: AuditEventRepository["record"];
  isDemoMode: () => boolean;
  requireLegacyIngestionKey: boolean;
  adminApiKey: () => string | undefined;
  defaultTenantId: () => string;
};

export const ingestionRoutes: FastifyPluginAsync<IngestionRoutesDependencies> = async (app, dependencies) => {
  const { authorizeMember, authorizeAdmin } = dependencies;
  async function queueWorkspaceUpload(
    actor: { tenantId: string; userId: string }, requestId: string,
    upload: Omit<Parameters<QueueDocumentUploadUseCase["execute"]>[0], "tenantId">,
    sourceType: "file" | "url" | "demo", idempotencyKey?:string
  ) {
    const job = await dependencies.queueDocumentUpload.execute({ ...upload, tenantId: actor.tenantId, actorId:actor.userId, ...(idempotencyKey?{idempotencyKey}:{}) });
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
    const uploadKey=z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/).optional().parse(request.headers["idempotency-key"]);
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "A document file is required." });
    const sourceHeader = request.headers["x-document-source"];
    const titleHeader = request.headers["x-document-title"];
    const input = z.object({ source: z.string().min(3).max(1_000), title: z.string().min(1).max(500).optional() }).parse({ source: sourceHeader ?? `upload/${file.filename}`, title: titleHeader || undefined });
    const job = await queueWorkspaceUpload(authorization, request.id, {
      ...input, filename: file.filename, mimeType: file.mimetype || "application/octet-stream", payload: await file.toBuffer()
    }, "file", uploadKey);
    if (!job) return reply.code(429).send({ error: "Daily upload quota reached. Try again tomorrow." });
    return reply.code(202).send({ job: serializeJob(job) });
  });
  app.post("/v1/admin/uploads/url", { bodyLimit: 8_000, config: { rateLimit: { max: 6 } } }, async (request, reply) => {
    const authorization = await authorizeAdmin(request, true);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const uploadKey=z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/).optional().parse(request.headers["idempotency-key"]);
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
    }, "url", uploadKey);
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
  app.post("/v1/documents", async (request, reply) => {
    if (dependencies.isDemoMode() || dependencies.requireLegacyIngestionKey) {
      const providedAdminKey = request.headers["x-admin-api-key"];
      const adminKey = typeof providedAdminKey === "string" ? providedAdminKey : undefined;
      const expectedKey = dependencies.adminApiKey();
      if (!expectedKey || !matchesApiKey(adminKey, expectedKey)) return reply.code(401).send({ error: "Unauthorized" });
    }
    const input = documentInputSchema.parse(request.body);
    const textBytes = Buffer.byteLength(input.text, "utf8");
    const quota = await dependencies.consumeAdminUploadQuota(dependencies.defaultTenantId(), "api-key", textBytes);
    if (!quota.allowed) return reply.code(429).send({ error: "Daily upload quota reached. Try again tomorrow." });
    // Only the upload worker can associate an indexed revision with an original.
    const metadata = { ...input.metadata };
    delete metadata.ingestionJobId;
    const result = await dependencies.ingestDocument.execute({ ...input, metadata, tenantId: dependencies.defaultTenantId() });
    await dependencies.recordAuditEvent({
      tenantId: dependencies.defaultTenantId(),
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
};
