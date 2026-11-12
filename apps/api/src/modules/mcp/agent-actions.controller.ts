import { Controller, Get, Head, HttpCode, Inject, Post, Req, Res, UseGuards, UseInterceptors } from "@nestjs/common";
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpReplyInterceptor } from "../../platform/http/nest-http-reply.interceptor.js";
import { AGENT_ACTIONS_HTTP, createAgentActionsHandlers, type AgentActionRoutesDependencies } from './http/agent-actions.handlers.js';
import { ApprovedActionOwnerGuard } from "./http/mcp-http.guards.js";
@Controller()
@UseInterceptors(HttpReplyInterceptor)
@UseGuards(ApprovedActionOwnerGuard)
export class AgentActionsController {
    private readonly handlers;
    constructor(
    @Inject(AGENT_ACTIONS_HTTP)
    dependencies: AgentActionRoutesDependencies) { this.handlers = createAgentActionsHandlers(dependencies); }
    @Post("/v1/agent-actions")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { bodyLimit: 512, config: { rateLimit: { max: 6 } } } })
    requestAction(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.requestAction(request, reply); }
    @Post("/v1/agent-actions/:actionId/approve")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {
            bodyLimit: 512, config: { rateLimit: { max: 6 } }
        } })
    approve(
    @Req()
    request: FastifyRequest<{
        Params: {
            actionId: string;
        };
    }>,
    @Res()
    reply: FastifyReply) { return this.handlers.approve(request, reply); }
    @Get("/v1/agent-actions/:actionId")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    get(
    @Req()
    request: FastifyRequest<{
        Params: {
            actionId: string;
        };
    }>,
    @Res()
    reply: FastifyReply) { return this.handlers.get(request, reply); }
    @Head("/v1/agent-actions/:actionId")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    getHead(
    @Req()
    request: FastifyRequest<{
        Params: {
            actionId: string;
        };
    }>,
    @Res()
    reply: FastifyReply) { return this.handlers.get(request, reply); }
}
// Explicit compatibility exports for CLI/transport fixtures.
export { AGENT_ACTIONS_HTTP, createAgentActionsHandlers, registerAgentActionRoutes } from './http/agent-actions.handlers.js';
export type { AgentActionRoutesDependencies, AgentActions } from './http/agent-actions.handlers.js';
