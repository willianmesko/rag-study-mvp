import { Controller, Delete, Get, Head, HttpCode, Inject, Post, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpReplyInterceptor } from "../../platform/http/nest-http-reply.interceptor.js";
import { WorkspaceAccess, WorkspaceRoleGuard } from '../../platform/http/nest-workspace.guard.js';
import { createDocumentsHandlers, DOCUMENTS_HTTP, type DocumentRoutesDependencies } from './http/documents.handlers.js';
@Controller()
@UseInterceptors(HttpReplyInterceptor)
@UseGuards(WorkspaceRoleGuard)
export class DocumentsController {
    private readonly handlers;
    constructor(
    @Inject(DOCUMENTS_HTTP)
    dependencies: DocumentRoutesDependencies) { this.handlers = createDocumentsHandlers(dependencies); }
    @Get("/v1/admin/documents")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'member', explicit: false })
    list(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.list(request, reply); }
    @Head("/v1/admin/documents")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'member', explicit: false })
    listHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.list(request, reply); }
    @Get("/v1/admin/documents/:documentId/chunks")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'member', explicit: false })
    chunks(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.chunks(request, reply); }
    @Head("/v1/admin/documents/:documentId/chunks")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'member', explicit: false })
    chunksHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.chunks(request, reply); }
    @Get("/v1/admin/documents/:documentId/original")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { exposeHeadRoute: false } })
    @WorkspaceAccess({ role: 'member', explicit: true })
    original(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.original(request, reply); }
    @Post("/v1/admin/documents/:documentId/reindex")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'admin', explicit: false })
    reindex(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.reindex(request, reply); }
    @Delete("/v1/admin/documents/:documentId")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'admin', explicit: false })
    remove(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.remove(request, reply); }
}
// Explicit compatibility exports for CLI/transport fixtures.
export { createDocumentsHandlers, documentRoutes, DOCUMENTS_HTTP } from './http/documents.handlers.js';
export type { DocumentRoutesDependencies } from './http/documents.handlers.js';
