import { Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpReplyInterceptor } from "../../platform/http/nest-http-reply.interceptor.js";
import { WorkspaceAccess, WorkspaceRoleGuard } from '../../platform/http/nest-workspace.guard.js';
import { CHAT_HTTP, createChatHandlers, type ChatRoutesDependencies } from './http/chat.handlers.js';
@Controller()
@UseInterceptors(HttpReplyInterceptor)
@UseGuards(WorkspaceRoleGuard)
export class ChatController {
    private readonly handlers;
    constructor(
    @Inject(CHAT_HTTP)
    dependencies: ChatRoutesDependencies) { this.handlers = createChatHandlers(dependencies); }
    @Post("/v1/qa/compare")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { config: { rateLimit: { max: 'question' } } } })
    @WorkspaceAccess({ role: 'member', explicit: true })
    compare(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.compare(request, reply); }
    @Post("/v1/qa")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { config: { rateLimit: { max: 'question' } } } })
    @WorkspaceAccess({ role: "handler", explicit: false })
    answer(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.answer(request, reply); }
    @Post("/v1/qa/stream")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { config: { rateLimit: { max: 'question' } } } })
    @WorkspaceAccess({ role: "handler", explicit: false })
    stream(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.stream(request, reply); }
    @Get("/v1/qa/runs/:runId/events")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { exposeHeadRoute: false } })
    @WorkspaceAccess({ role: 'member', explicit: true })
    replay(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.replay(request, reply); }
    @Post("/v1/qa/runs/:runId/cancel")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'member', explicit: true })
    cancel(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.cancel(request, reply); }
}
// Explicit compatibility exports for CLI/transport fixtures.
export { CHAT_HTTP, chatRoutes, createChatHandlers } from './http/chat.handlers.js';
export type { ChatRoutesDependencies } from './http/chat.handlers.js';
