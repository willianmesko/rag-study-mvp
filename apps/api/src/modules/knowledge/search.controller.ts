import { Controller, Get, Head, HttpCode, Inject, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpReplyInterceptor } from "../../platform/http/nest-http-reply.interceptor.js";
import { WorkspaceAccess, WorkspaceRoleGuard } from '../../platform/http/nest-workspace.guard.js';
import { createSearchHandlers, SEARCH_HTTP, type SearchRoutesDependencies } from './http/search.handlers.js';
@Controller()
@UseInterceptors(HttpReplyInterceptor)
@UseGuards(WorkspaceRoleGuard)
export class SearchController {
    private readonly handlers;
    constructor(
    @Inject(SEARCH_HTTP)
    dependencies: SearchRoutesDependencies) { this.handlers = createSearchHandlers(dependencies); }
    @Get("/v1/knowledge/status")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: "handler", explicit: false })
    status(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.status(request, reply); }
    @Head("/v1/knowledge/status")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: "handler", explicit: false })
    statusHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.status(request, reply); }
    @Get("/v1/search")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: "handler", explicit: false })
    search(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.search(request, reply); }
    @Head("/v1/search")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: "handler", explicit: false })
    searchHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.search(request, reply); }
}
// Explicit compatibility exports for CLI/transport fixtures.
export { createSearchHandlers, SEARCH_HTTP, searchRoutes } from './http/search.handlers.js';
export type { SearchRoutesDependencies } from './http/search.handlers.js';
