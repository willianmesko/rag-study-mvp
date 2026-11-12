import { Controller, Get, Head, HttpCode, Inject, Post, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpReplyInterceptor } from "../../platform/http/nest-http-reply.interceptor.js";
import { WorkspaceAccess, WorkspaceRoleGuard } from '../../platform/http/nest-workspace.guard.js';
import { createIngestionHandlers, INGESTION_HTTP, type IngestionRoutesDependencies } from './http/ingestion.handlers.js';
@Controller()
@UseInterceptors(HttpReplyInterceptor)
@UseGuards(WorkspaceRoleGuard)
export class IngestionController {
    private readonly handlers;
    constructor(
    @Inject(INGESTION_HTTP)
    dependencies: IngestionRoutesDependencies) { this.handlers = createIngestionHandlers(dependencies); }
    @Get("/v1/demo-libraries")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { exposeHeadRoute: false } })
    @WorkspaceAccess({ role: 'member', explicit: true })
    getDemoLibraries(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.getDemoLibraries(request, reply); }
    @Post("/v1/admin/demo-libraries/:libraryId/documents/:documentKey")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { bodyLimit: 2048, config: { rateLimit: { max: 20 } } } })
    @WorkspaceAccess({ role: 'admin', explicit: true })
    postAdminDemoLibrariesDocuments(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.postAdminDemoLibrariesDocuments(request, reply); }
    @Post("/v1/admin/uploads")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'admin', explicit: false })
    postAdminUploads(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.postAdminUploads(request, reply); }
    @Post("/v1/admin/uploads/url")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { bodyLimit: 8000, config: { rateLimit: { max: 6 } } } })
    @WorkspaceAccess({ role: 'admin', explicit: true })
    postAdminUploadsUrl(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.postAdminUploadsUrl(request, reply); }
    @Get("/v1/admin/uploads")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'member', explicit: false })
    getAdminUploads(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.getAdminUploads(request, reply); }
    @Head("/v1/admin/uploads")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'member', explicit: false })
    getAdminUploadsHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.getAdminUploads(request, reply); }
    @Get("/v1/admin/uploads/:jobId/events")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'member', explicit: false })
    getAdminUploadsEvents(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.getAdminUploadsEvents(request, reply); }
    @Head("/v1/admin/uploads/:jobId/events")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'member', explicit: false })
    getAdminUploadsEventsHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.getAdminUploadsEvents(request, reply); }
    @Get("/v1/admin/uploads/:jobId/preview")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { exposeHeadRoute: false } })
    @WorkspaceAccess({ role: 'admin', explicit: true })
    getAdminUploadsPreview(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.getAdminUploadsPreview(request, reply); }
    @Post("/v1/admin/uploads/:jobId/cancel")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'admin', explicit: false })
    postAdminUploadsCancel(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.postAdminUploadsCancel(request, reply); }
    @Post("/v1/admin/uploads/:jobId/retry")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'admin', explicit: false })
    postAdminUploadsRetry(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.postAdminUploadsRetry(request, reply); }
    @Post("/v1/documents")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: "handler", explicit: false })
    postDocuments(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.postDocuments(request, reply); }
}
// Explicit compatibility exports for CLI/transport fixtures.
export { createIngestionHandlers, INGESTION_HTTP, ingestionRoutes } from './http/ingestion.handlers.js';
export type { IngestionRoutesDependencies } from './http/ingestion.handlers.js';
