import { Inject, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { mcpAccessTokenSchema, mcpWorkspaceIdSchema } from "@rag-study/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { HttpAccessDenied } from "../../../platform/http/nest-workspace.guard.js";
import { REMOTE_MCP_HTTP, type RemoteMcpRoutesDependencies } from "../infrastructure/remote.js";
import { AGENT_ACTIONS_HTTP, type AgentActionRoutesDependencies } from "./agent-actions.handlers.js";
import { MCP_OAUTH_HTTP, type McpOAuthRoutesDependencies } from "./mcp-oauth.handlers.js";
import { WORKSPACE_MCP_HTTP, type WorkspaceMcpRoutesDependencies } from "./workspace-mcp.handlers.js";
const http = (context: ExecutionContext) => ({ request: context.switchToHttp().getRequest<FastifyRequest>(), reply: context.switchToHttp().getResponse<FastifyReply>() });
const deny = (_reply: FastifyReply, status: number, body: object): never => { throw new HttpAccessDenied(status, body); };
@Injectable()
export class ApprovedActionOwnerGuard implements CanActivate {
    constructor(
    @Inject(AGENT_ACTIONS_HTTP)
    private readonly dependencies: AgentActionRoutesDependencies) { }
    async canActivate(context: ExecutionContext) {
        const { request, reply } = http(context);
        const scope = await this.dependencies.authorize(request);
        if (!scope.ok)
            return deny(reply, scope.status, { code: scope.code, error: scope.error });
        if (scope.role !== "owner")
            return deny(reply, 403, { code: "forbidden", error: "Workspace owner access is required." });
        return true;
    }
}
@Injectable()
export class McpManagementGuard implements CanActivate {
    constructor(
    @Inject(WORKSPACE_MCP_HTTP)
    private readonly dependencies: WorkspaceMcpRoutesDependencies) { }
    async canActivate(context: ExecutionContext) {
        const { request, reply } = http(context);
        if (request.headers.authorization?.startsWith("Bearer lumora_mcp_"))
            return deny(reply, 401, { error: "Sign in to manage MCP access." });
        const scope = await this.dependencies.authorize(request);
        return scope.ok || deny(reply, scope.status, { code: scope.code, error: scope.error });
    }
}
@Injectable()
export class McpToolInputGuard implements CanActivate {
    canActivate(context: ExecutionContext) {
        const { request, reply } = http(context), authorization = request.headers.authorization;
        if (!mcpAccessTokenSchema.safeParse(authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined).success)
            return deny(reply, 401, { code: "mcp_access_required", error: "A temporary MCP credential is required." });
        if (!mcpWorkspaceIdSchema.safeParse(request.headers["x-workspace-id"]).success)
            return deny(reply, 400, { code: "workspace_required", error: "Select a valid workspace." });
        return true;
    }
}
const CONSENT = Symbol("mcp-consent-access");
export const McpConsent = (mode: "public" | "user" | "member") => SetMetadata(CONSENT, mode);
@Injectable()
export class McpConsentGuard implements CanActivate {
    constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(MCP_OAUTH_HTTP)
    private readonly dependencies: McpOAuthRoutesDependencies) { }
    async canActivate(context: ExecutionContext) {
        const policy = this.reflector.get<"public" | "user" | "member" | undefined>(CONSENT, context.getHandler());
        if (!policy)
            throw new Error("MCP consent access policy is missing.");
        if (policy === "public")
            return true;
        const { request, reply } = http(context);
        const scope = policy === "user" ? await this.dependencies.authorizeUser(request) : await this.dependencies.authorize(request);
        return scope.ok || deny(reply, scope.status, { ...(policy === "member" && "code" in scope ? { code: scope.code } : {}), error: scope.error });
    }
}
@Injectable()
export class RemoteMcpSessionGuard implements CanActivate {
    constructor(
    @Inject(REMOTE_MCP_HTTP)
    private readonly dependencies: RemoteMcpRoutesDependencies) { }
    async canActivate(context: ExecutionContext) {
        const { request, reply } = http(context);
        const principal = await this.dependencies.principalFor!(request);
        if (!principal) {
            reply.header("www-authenticate", `Bearer resource_metadata="${this.dependencies.oauth.issuer}/.well-known/oauth-protected-resource/mcp", scope="workspace:read"`);
            return deny(reply, 401, { error: "invalid_token" });
        }
        if (request.headers["x-workspace-id"] !== undefined && request.headers["x-workspace-id"] !== principal.tenantId)
            return deny(reply, 403, { error: "workspace_mismatch" });
        return true;
    }
}
