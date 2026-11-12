import { Controller, Delete, Get, Head, HttpCode, Inject, Post, Req, Res, UseGuards, UseInterceptors } from "@nestjs/common";
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpReplyInterceptor } from "../../platform/http/nest-http-reply.interceptor.js";
import { McpConsent, McpConsentGuard } from "./http/mcp-http.guards.js";
import { createMcpOAuthHandlers, MCP_OAUTH_HTTP, type McpOAuthRoutesDependencies } from './http/mcp-oauth.handlers.js';
@Controller()
@UseInterceptors(HttpReplyInterceptor)
@UseGuards(McpConsentGuard)
export class McpOAuthController {
    private readonly handlers;
    constructor(
    @Inject(MCP_OAUTH_HTTP)
    dependencies: McpOAuthRoutesDependencies) { this.handlers = createMcpOAuthHandlers(dependencies); }
    @Get("/.well-known/oauth-authorization-server")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: {} })
    @McpConsent("public")
    metadata(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.metadata(request, reply); }
    @Head("/.well-known/oauth-authorization-server")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: {} })
    @McpConsent("public")
    metadataHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.metadata(request, reply); }
    @Get("/.well-known/oauth-protected-resource")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: {} })
    @McpConsent("public")
    protectedMetadata(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.protectedMetadata(request, reply); }
    @Head("/.well-known/oauth-protected-resource")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: {} })
    @McpConsent("public")
    protectedMetadataHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.protectedMetadata(request, reply); }
    @Get("/.well-known/oauth-protected-resource/mcp")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: {} })
    @McpConsent("public")
    protectedMcpMetadata(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.protectedMcpMetadata(request, reply); }
    @Head("/.well-known/oauth-protected-resource/mcp")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: {} })
    @McpConsent("public")
    protectedMcpMetadataHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.protectedMcpMetadata(request, reply); }
    @Post("/oauth/register")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: { bodyLimit: 8192, config: { rateLimit: { max: 4, timeWindow: "1 hour" } } } })
    @McpConsent("public")
    register(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.register(request, reply); }
    @Get("/oauth/authorize")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: { config: { rateLimit: { max: 20 } } } })
    @McpConsent("public")
    authorize(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.redirectAuthorization(request, reply); }
    @Head("/oauth/authorize")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: { config: { rateLimit: { max: 20 } } } })
    @McpConsent("public")
    authorizeHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.redirectAuthorization(request, reply); }
    @Post("/oauth/token")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: { bodyLimit: 8192, config: { rateLimit: { max: 30 } } } })
    @McpConsent("public")
    exchange(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.exchange(request, reply); }
    @Post("/oauth/revoke")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: { bodyLimit: 1024, config: { rateLimit: { max: 30 } } } })
    @McpConsent("public")
    revoke(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.revoke(request, reply); }
    @Get("/v1/mcp/oauth/requests/:id")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: {} })
    @McpConsent("user")
    details(
    @Req()
    request: FastifyRequest<{
        Params: {
            id: string;
        };
    }>,
    @Res()
    reply: FastifyReply) { return this.handlers.details(request, reply); }
    @Head("/v1/mcp/oauth/requests/:id")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: {} })
    @McpConsent("user")
    detailsHead(
    @Req()
    request: FastifyRequest<{
        Params: {
            id: string;
        };
    }>,
    @Res()
    reply: FastifyReply) { return this.handlers.details(request, reply); }
    @Post("/v1/mcp/oauth/requests/:id/approve")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: { bodyLimit: 1024, config: { rateLimit: { max: 10 } } } })
    @McpConsent("member")
    approve(
    @Req()
    request: FastifyRequest<{
        Params: {
            id: string;
        };
    }>,
    @Res()
    reply: FastifyReply) { return this.handlers.approve(request, reply); }
    @Post("/v1/mcp/oauth/requests/:id/deny")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: { bodyLimit: 128, config: { rateLimit: { max: 10 } } } })
    @McpConsent("user")
    deny(
    @Req()
    request: FastifyRequest<{
        Params: {
            id: string;
        };
    }>,
    @Res()
    reply: FastifyReply) { return this.handlers.deny(request, reply); }
    @Get("/v1/mcp/connections")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: {} })
    @McpConsent("member")
    connections(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.connections(request, reply); }
    @Head("/v1/mcp/connections")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: {} })
    @McpConsent("member")
    connectionsHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.connections(request, reply); }
    @Delete("/v1/mcp/connections/:id")
    @HttpCode(200)
    @RouteConfig({ lumoraOAuth: true, lumoraHttp: { config: { rateLimit: { max: 10 } } } })
    @McpConsent("member")
    disconnect(
    @Req()
    request: FastifyRequest<{
        Params: {
            id: string;
        };
    }>,
    @Res()
    reply: FastifyReply) { return this.handlers.disconnect(request, reply); }
}
// Explicit compatibility exports for CLI/transport fixtures.
export { createMcpOAuthHandlers, createOAuthErrorHandler, isRemoteMcpPath, MCP_OAUTH_HTTP, registerMcpOAuthRoutes, uniqueOAuthParameters } from './http/mcp-oauth.handlers.js';
export type { AuthorizeMcpUser, McpOAuthRoutesDependencies } from './http/mcp-oauth.handlers.js';
