import { Controller, Delete, Get, Head, HttpCode, Inject, Post, Req, Res, UseGuards, UseInterceptors } from "@nestjs/common";
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpReplyInterceptor } from "../../platform/http/nest-http-reply.interceptor.js";
import { McpManagementGuard, McpToolInputGuard } from "./http/mcp-http.guards.js";
import { createWorkspaceMcpHandlers, WORKSPACE_MCP_HTTP, type WorkspaceMcpRoutesDependencies } from './http/workspace-mcp.handlers.js';
@Controller()
@UseInterceptors(HttpReplyInterceptor)
export class WorkspaceMcpController {
    private readonly handlers;
    constructor(
    @Inject(WORKSPACE_MCP_HTTP)
    dependencies: WorkspaceMcpRoutesDependencies) { this.handlers = createWorkspaceMcpHandlers(dependencies); }
    @Get("/v1/mcp/access")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @UseGuards(McpManagementGuard)
    status(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.status(request, reply); }
    @Head("/v1/mcp/access")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @UseGuards(McpManagementGuard)
    statusHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.status(request, reply); }
    @Post("/v1/mcp/access")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { bodyLimit: 256, config: { rateLimit: { max: 4 } } } })
    @UseGuards(McpManagementGuard)
    issue(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.issue(request, reply); }
    @Delete("/v1/mcp/access")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { config: { rateLimit: { max: 4 } } } })
    @UseGuards(McpManagementGuard)
    revoke(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.revoke(request, reply); }
    @Post("/v1/mcp/tools/:tool")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { bodyLimit: 2048 } })
    @UseGuards(McpToolInputGuard)
    callTool(
    @Req()
    request: FastifyRequest<{
        Params: {
            tool: string;
        };
    }>,
    @Res()
    reply: FastifyReply) { return this.handlers.callTool(request, reply); }
}
// Explicit compatibility exports for CLI/transport fixtures.
export { createWorkspaceMcpHandlers, registerWorkspaceMcpRoutes, WORKSPACE_MCP_HTTP } from './http/workspace-mcp.handlers.js';
export type { WorkspaceMcp, WorkspaceMcpRoutesDependencies } from './http/workspace-mcp.handlers.js';
