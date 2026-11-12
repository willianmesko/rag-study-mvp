import { Controller, Get, Head, HttpCode, Inject, Post, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpReplyInterceptor } from "../../platform/http/nest-http-reply.interceptor.js";
import { WorkspaceAccess, WorkspaceRoleGuard } from '../../platform/http/nest-workspace.guard.js';
import { createEvaluationsHandlers, EVALUATIONS_HTTP, type EvaluationRoutesDependencies } from './http/evaluations.handlers.js';
@Controller()
@UseInterceptors(HttpReplyInterceptor)
@UseGuards(WorkspaceRoleGuard)
export class EvaluationsController {
    private readonly handlers;
    constructor(
    @Inject(EVALUATIONS_HTTP)
    dependencies: EvaluationRoutesDependencies) { this.handlers = createEvaluationsHandlers(dependencies); }
    @Get("/v1/admin/evaluations")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'owner', explicit: false })
    list(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.list(request, reply); }
    @Head("/v1/admin/evaluations")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'owner', explicit: false })
    listHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.list(request, reply); }
    @Post("/v1/admin/evaluations/run")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { config: { rateLimit: { max: 2 } } } })
    @WorkspaceAccess({ role: 'owner', explicit: false })
    run(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.run(request, reply); }
    @Post("/v1/admin/evaluation-workflows")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { config: { rateLimit: { max: 2 } } } })
    @WorkspaceAccess({ role: 'owner', explicit: true })
    startWorkflow(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.startWorkflow(request, reply); }
    @Post("/v1/admin/evaluation-workflows/:runId/:action")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'owner', explicit: true })
    changeWorkflow(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.changeWorkflow(request, reply); }
}
// Explicit compatibility exports for CLI/transport fixtures.
export { createEvaluationsHandlers, evaluationRoutes, EVALUATIONS_HTTP } from './http/evaluations.handlers.js';
export type { EvaluationRoutesDependencies } from './http/evaluations.handlers.js';
