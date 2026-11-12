import { Controller, Delete, Get, Head, HttpCode, Inject, Post, Req, Res, UseGuards, UseInterceptors } from "@nestjs/common";
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpReplyInterceptor } from "../../platform/http/nest-http-reply.interceptor.js";
import { RemoteMcpSessionGuard } from "./http/mcp-http.guards.js";
import { createRemoteMcpHandlers, REMOTE_MCP_HTTP, type RemoteMcpRoutesDependencies } from './infrastructure/remote.js';
@Controller()
@UseInterceptors(HttpReplyInterceptor)
@UseGuards(RemoteMcpSessionGuard)
export class RemoteMcpController {
    private readonly handlers;
    constructor(
    @Inject(REMOTE_MCP_HTTP)
    dependencies: RemoteMcpRoutesDependencies) { this.handlers = createRemoteMcpHandlers(dependencies); }
    @Get("/mcp")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { bodyLimit: 8192, config: { rateLimit: { max: 120 } } } })
    requestGET(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.request(request, reply); }
    @Head("/mcp")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { bodyLimit: 8192, config: { rateLimit: { max: 120 } } } })
    requestGETHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.request(request, reply); }
    @Post("/mcp")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { bodyLimit: 8192, config: { rateLimit: { max: 120 } } } })
    requestPOST(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.request(request, reply); }
    @Delete("/mcp")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { bodyLimit: 8192, config: { rateLimit: { max: 120 } } } })
    requestDELETE(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.request(request, reply); }
}
