import { Controller, Delete, Get, Head, HttpCode, Inject, Patch, Post, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpReplyInterceptor } from "../../platform/http/nest-http-reply.interceptor.js";
import { WorkspaceAccess, WorkspaceRoleGuard } from '../../platform/http/nest-workspace.guard.js';
import { createWorkspaceTeamHandlers, WORKSPACE_TEAM_HTTP, type WorkspaceTeamRoutesDependencies } from './http/workspace-team.handlers.js';
@Controller()
@UseInterceptors(HttpReplyInterceptor)
@UseGuards(WorkspaceRoleGuard)
export class WorkspaceTeamController {
    private readonly handlers;
    constructor(
    @Inject(WORKSPACE_TEAM_HTTP)
    dependencies: WorkspaceTeamRoutesDependencies) { this.handlers = createWorkspaceTeamHandlers(dependencies); }
    @Get("/v1/workspaces/:workspaceId/members")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'owner', explicit: false })
    listMembers(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.listMembers(request, reply); }
    @Head("/v1/workspaces/:workspaceId/members")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'owner', explicit: false })
    listMembersHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.listMembers(request, reply); }
    @Get('/v1/workspaces/:workspaceId/invitation-deliveries')
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'owner', explicit: true })
    listInvitationDeliveries(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.listInvitationDeliveries(request, reply); }
    @Head('/v1/workspaces/:workspaceId/invitation-deliveries')
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'owner', explicit: true })
    listInvitationDeliveriesHead(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.listInvitationDeliveries(request, reply); }
    @Post("/v1/workspaces/:workspaceId/invitations")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: { bodyLimit: 2048, config: { rateLimit: { max: 6 } } } })
    @WorkspaceAccess({ role: 'owner', explicit: false })
    invite(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.invite(request, reply); }
    @Patch("/v1/workspaces/:workspaceId/members/:userId")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'owner', explicit: false })
    changeRole(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.changeRole(request, reply); }
    @Delete("/v1/workspaces/:workspaceId/members/:userId")
    @HttpCode(200)
    @RouteConfig({ lumoraHttp: {} })
    @WorkspaceAccess({ role: 'owner', explicit: false })
    removeMember(
    @Req()
    request: FastifyRequest,
    @Res()
    reply: FastifyReply) { return this.handlers.removeMember(request, reply); }
}
// Explicit compatibility exports for CLI/transport fixtures.
export { createWorkspaceTeamHandlers, WORKSPACE_TEAM_HTTP, workspaceTeamRoutes } from './http/workspace-team.handlers.js';
export type { WorkspaceTeamRoutesDependencies } from './http/workspace-team.handlers.js';
