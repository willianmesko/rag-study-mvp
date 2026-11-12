import { Controller, Get, HttpCode, Inject, Patch, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpReplyInterceptor } from "../../platform/http/nest-http-reply.interceptor.js";
import { WorkspaceAccess, WorkspaceRoleGuard } from '../../platform/http/nest-workspace.guard.js';
import { CHAT_MODELS_HTTP, createChatModelsHandlers, type ChatModelRoutesDependencies } from './http/chat-models.handlers.js';
@Controller()
@UseInterceptors(HttpReplyInterceptor)
@UseGuards(WorkspaceRoleGuard)
export class ChatModelsController {
    private readonly handlers;
    constructor(
    @Inject(CHAT_MODELS_HTTP)
    dependencies: ChatModelRoutesDependencies) { this.handlers = createChatModelsHandlers(dependencies); }
    @Get("/v1/admin/chat-model-policy")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { exposeHeadRoute: false } })
    @WorkspaceAccess({ role: 'owner', explicit: true })
    getPolicy(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.getPolicy(request, reply); }
    @Patch("/v1/admin/chat-model-policy")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { bodyLimit: 4096 } })
    @WorkspaceAccess({ role: 'owner', explicit: true })
    updatePolicy(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.updatePolicy(request, reply); }
    @Get("/v1/qa/models")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { exposeHeadRoute: false } })
    @WorkspaceAccess({ role: 'member', explicit: true })
    listModels(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.listModels(request, reply); }
}
// Explicit compatibility exports for CLI/transport fixtures.
export { CHAT_MODELS_HTTP, chatModelRoutes, createChatModelsHandlers } from './http/chat-models.handlers.js';
export type { ChatModelRoutesDependencies } from './http/chat-models.handlers.js';
