import { Controller, Delete, Get, Head, HttpCode, Inject, Patch, Post, Put, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { HttpReplyInterceptor } from "../../platform/http/nest-http-reply.interceptor.js";
import { HTTP_TRANSPORT_LOGGER, WorkspaceAccess, WorkspaceRoleGuard } from '../../platform/http/nest-workspace.guard.js';
import { CONVERSATIONS_HTTP, createConversationsHandlers, type ConversationRoutesDependencies } from './http/conversations.handlers.js';
@Controller()
@UseInterceptors(HttpReplyInterceptor)
@UseGuards(WorkspaceRoleGuard)
@WorkspaceAccess({ role: "member", explicit: true })
export class ConversationsController {
    private readonly handlers;
    constructor(
    @Inject(CONVERSATIONS_HTTP)
    deps: ConversationRoutesDependencies,
    @Inject(HTTP_TRANSPORT_LOGGER)
    logger: Pick<FastifyInstance, "log">) { this.handlers = createConversationsHandlers(deps, logger); }
    onApplicationBootstrap() { return this.handlers.start(); }
    onModuleDestroy() { return this.handlers.close(); }
    @Get("/v1/conversations")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    list(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.list(request, reply); }
    @Head("/v1/conversations")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    listHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.list(request, reply); }
    @Post("/v1/conversations")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { bodyLimit: 1024, config: { rateLimit: { max: 10 } } } })
    create(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.create(request, reply); }
    @Delete("/v1/conversations")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    deleteAll(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.deleteAll(request, reply); }
    @Get("/v1/conversations/:id/messages")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    messages(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.messages(request, reply); }
    @Head("/v1/conversations/:id/messages")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    messagesHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.messages(request, reply); }
    @Patch("/v1/conversations/:id")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { bodyLimit: 1024 } })
    rename(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.rename(request, reply); }
    @Delete("/v1/conversations/:id")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    remove(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.remove(request, reply); }
    @Put("/v1/conversations/:id/messages/:messageId/feedback")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { bodyLimit: 128, config: { rateLimit: { max: 30 } } } })
    feedback(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.feedback(request, reply); }
    @Get("/v1/conversations/:id/runs/:runId")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    turn(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.turn(request, reply); }
    @Head("/v1/conversations/:id/runs/:runId")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    turnHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.turn(request, reply); }
    @Post("/v1/conversations/:id/runs/:runId/cancel")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    cancel(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.cancel(request, reply); }
}
// Explicit compatibility exports for CLI/transport fixtures.
export { CONVERSATIONS_HTTP, createConversationsHandlers, registerConversationRoutes } from './http/conversations.handlers.js';
export type { ConversationRoutesDependencies } from './http/conversations.handlers.js';
