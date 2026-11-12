import { Controller, Get, Head, HttpCode, Inject, Post, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpReplyInterceptor } from "../../platform/http/nest-http-reply.interceptor.js";
import { WorkspaceAccess, WorkspaceRoleGuard } from '../../platform/http/nest-workspace.guard.js';
import { createOperationsHandlers, OPERATIONS_HTTP, type OperationsRoutesDependencies } from './http/operations.handlers.js';
@Controller()
@UseInterceptors(HttpReplyInterceptor)
@UseGuards(WorkspaceRoleGuard)
export class OperationsController {
    private readonly handlers;
    constructor(
    @Inject(OPERATIONS_HTTP)
    dependencies: OperationsRoutesDependencies) { this.handlers = createOperationsHandlers(dependencies); }
    @Get('/v1/admin/alerts')
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'owner', explicit: true })
    alerts(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.alerts(request, reply); }
    @Head('/v1/admin/alerts')
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'owner', explicit: true })
    alertsHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.alerts(request, reply); }
    @Post('/v1/admin/alerts/:id/replay')
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { bodyLimit: 2048, config: { rateLimit: { max: 6 } } } })
    @WorkspaceAccess({ role: 'owner', explicit: true })
    replayAlert(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.replayAlert(request, reply); }
    @Get("/v1/admin/usage")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'owner', explicit: true })
    usage(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.usage(request, reply); }
    @Head("/v1/admin/usage")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'owner', explicit: true })
    usageHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.usage(request, reply); }
}
// Explicit compatibility exports for CLI/transport fixtures.
export { createOperationsHandlers, OPERATIONS_HTTP, operationsRoutes } from './http/operations.handlers.js';
export type { OperationsRoutesDependencies } from './http/operations.handlers.js';
