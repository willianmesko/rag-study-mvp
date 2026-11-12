import { Controller, Get, Head, HttpCode, Inject, Patch, Post, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpReplyInterceptor } from "../../platform/http/nest-http-reply.interceptor.js";
import { WorkspaceAccess, WorkspaceRoleGuard } from '../../platform/http/nest-workspace.guard.js';
import { createWorkspacesHandlers, WORKSPACES_HTTP, type WorkspaceRoutesDependencies } from './http/workspaces.handlers.js';
@Controller()
@UseInterceptors(HttpReplyInterceptor)
@UseGuards(WorkspaceRoleGuard)
export class WorkspacesController {
    private readonly handlers;
    constructor(
    @Inject(WORKSPACES_HTTP)
    dependencies: WorkspaceRoutesDependencies) { this.handlers = createWorkspacesHandlers(dependencies); }
    @Get("/v1/workspaces")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'user', explicit: false })
    list(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.list(request, reply); }
    @Head("/v1/workspaces")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'user', explicit: false })
    listHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.list(request, reply); }
    @Post("/v1/workspaces")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'user', explicit: false })
    create(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.create(request, reply); }
    @Get("/v1/workspaces/:workspaceId/onboarding")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { exposeHeadRoute: false, bodyLimit: 2048 } })
    @WorkspaceAccess({ role: 'member', explicit: true })
    onboardingGET(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.onboarding(request, reply); }
    @Patch("/v1/workspaces/:workspaceId/onboarding")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { exposeHeadRoute: false, bodyLimit: 2048 } })
    @WorkspaceAccess({ role: 'member', explicit: true })
    onboardingPATCH(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.onboarding(request, reply); }
}
// Explicit compatibility exports for CLI/transport fixtures.
export { createWorkspacesHandlers, workspaceRoutes, WORKSPACES_HTTP } from './http/workspaces.handlers.js';
export type { WorkspaceRoutesDependencies } from './http/workspaces.handlers.js';
