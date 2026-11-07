import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { documentFiltersSchema, type UploadJob } from "@rag-study/contracts";
import type { DocumentRepository, ManagedDocument, StoredChunk } from "./application/ports/document-repository.js";
import type { AuditEventRepository } from "../usage/index.js";
import type { GetDocumentOriginalUseCase } from "./application/use-cases/get-document-original.js";
import type { ReindexDocumentUseCase } from "../ingestion/index.js";
import type { DeleteDocumentUseCase } from "./application/use-cases/delete-document.js";
import { rejectScope, type WorkspaceAuthorizer } from "../../platform/http/workspace-authorization.js";

export type DocumentRoutesDependencies = {
  authorizeMember: WorkspaceAuthorizer;
  authorizeAdmin: WorkspaceAuthorizer;
  listDocuments: DocumentRepository["list"];
  listDocumentChunks: (tenantId: string, documentId: string, limit: number) => Promise<StoredChunk[]>;
  getDocumentOriginal: Pick<GetDocumentOriginalUseCase, "execute">;
  reindexDocument: Pick<ReindexDocumentUseCase, "execute">;
  serializeReindexJob: (job: NonNullable<Awaited<ReturnType<ReindexDocumentUseCase["execute"]>>>) => UploadJob;
  deleteDocument: Pick<DeleteDocumentUseCase, "execute">;
  invalidateSemanticCache: (tenantId: string) => Promise<void>;
  recordAuditEvent: AuditEventRepository["record"];
};

export const documentRoutes: FastifyPluginAsync<DocumentRoutesDependencies> = async (app, dependencies) => {
  const { authorizeMember, authorizeAdmin } = dependencies;
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
    return reply.code(202).send({ job: dependencies.serializeReindexJob(job) });
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
};

function originalFileDisposition(value: string): string {
  const basename = (value.split(/[/\\]/).at(-1) ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const filename = Array.from(basename).slice(0, 240).join("") || "document";
  const ascii = filename.replace(/[^a-zA-Z0-9 ._-]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function serializeDocument(document: ManagedDocument) {
  return {
    id: document.id, source: document.source, title: document.title, chunkCount: document.chunkCount, hasOriginal: document.hasOriginal,
    format: document.format, language: document.language, sectionCount: document.sectionCount,
    createdAt: document.createdAt.toISOString(), updatedAt: document.updatedAt.toISOString()
  };
}

function serializeStoredChunk(chunk: StoredChunk) {
  return { id: chunk.id, ordinal: chunk.ordinal, content: chunk.content, security: chunk.security, createdAt: chunk.createdAt.toISOString() };
}
