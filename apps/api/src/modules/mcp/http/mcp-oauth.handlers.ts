import { mcpConsentApprovalSchema } from "@rag-study/contracts";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from "zod";
import { frameworkRequestFailure } from "../../../platform/http/request-errors.js";
import type { ExplicitWorkspaceAuthorizer as AuthorizeExplicitMember } from "../../../platform/http/workspace-authorization.js";
import type { AuditEventRepository } from "../../usage/index.js";
import { McpOAuth, OAuthRequestError } from "../application/oauth.js";
export type AuthorizeMcpUser = (request: FastifyRequest) => Promise<{
    ok: true;
    userId: string;
} | {
    ok: false;
    status: number;
    error: string;
}>;
export const isRemoteMcpPath = (path: string) => ["/mcp", "/oauth/authorize", "/oauth/register", "/oauth/token", "/oauth/revoke",
    "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"].includes(path);
/** Reject duplicate form/query fields instead of accepting parser-dependent values. */
export function uniqueOAuthParameters(value: string): Record<string, string> {
    const result: Record<string, string> = Object.create(null);
    for (const [key, entry] of new URLSearchParams(value)) {
        if (Object.hasOwn(result, key))
            throw new OAuthRequestError("invalid_request", "Duplicate OAuth parameters are not supported.");
        result[key] = entry;
    }
    return result;
}
export type McpOAuthRoutesDependencies = {
    oauth: McpOAuth;
    authorize: AuthorizeExplicitMember;
    authorizeUser: AuthorizeMcpUser;
    audit: AuditEventRepository["record"];
};
export const MCP_OAUTH_HTTP = Symbol('mcp_oauth_http');
export function createMcpOAuthHandlers(dependencies: McpOAuthRoutesDependencies) {
    const { oauth, authorize, authorizeUser, audit } = dependencies;
    const metadata: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async () => oauth.metadata();
    const protectedMetadata: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async () => oauth.protectedMetadata();
    const protectedMcpMetadata: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async () => oauth.protectedMetadata();
    const register: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => reply.code(201).send(await oauth.register(request.body));
    const redirectAuthorization: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const query = request.raw.url?.split("?")[1] ?? "";
        return reply.code(303).header("location", await oauth.start(uniqueOAuthParameters(query))).send();
    };
    const exchange: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request) => oauth.exchange(request.body);
    const revoke: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const body = z.strictObject({ token: z.string().min(1).max(256), client_id: z.string().max(128).optional(),
            token_type_hint: z.enum(["access_token", "refresh_token"]).optional() }).parse(request.body);
        await oauth.revoke(body.token, body.client_id);
        return reply.code(200).send();
    };
    const details: (request: FastifyRequest<{
        Params: {
            id: string;
        };
    }>, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const user = await authorizeUser(request);
        if (!user.ok)
            return reply.code(user.status).send({ error: user.error });
        return oauth.details(z.uuid().parse(request.params.id));
    };
    const approve: (request: FastifyRequest<{
        Params: {
            id: string;
        };
    }>, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const scope = await authorize(request);
        if (!scope.ok)
            return reply.code(scope.status).send({ code: scope.code, error: scope.error });
        const id = z.uuid().parse(request.params.id);
        const { tools } = mcpConsentApprovalSchema.parse(request.body);
        const result = await oauth.approve({ id, tenantId: scope.tenantId, userId: scope.userId, tools });
        await audit({ tenantId: scope.tenantId, actorUserId: scope.userId, action: "mcp.oauth_approved", resourceType: "workspace_mcp",
            resourceId: id, requestId: request.id, metadata: { toolCount: tools.length } });
        return result;
    };
    const deny: (request: FastifyRequest<{
        Params: {
            id: string;
        };
    }>, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const user = await authorizeUser(request);
        if (!user.ok)
            return reply.code(user.status).send({ error: user.error });
        return oauth.deny(z.uuid().parse(request.params.id));
    };
    const connections: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const scope = await authorize(request);
        if (!scope.ok)
            return reply.code(scope.status).send({ code: scope.code, error: scope.error });
        const grants = await oauth.repository.grants(scope.userId, scope.tenantId);
        return { url: oauth.resource, connections: grants.map(({ id, clientName, allowedTools, expiresAt, createdAt }) => ({ id, clientName, allowedTools, expiresAt: expiresAt.toISOString(), createdAt: createdAt.toISOString() })) };
    };
    const disconnect: (request: FastifyRequest<{
        Params: {
            id: string;
        };
    }>, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const scope = await authorize(request);
        if (!scope.ok)
            return reply.code(scope.status).send({ code: scope.code, error: scope.error });
        const id = z.uuid().parse(request.params.id);
        if (!await oauth.repository.revokeGrant(scope.userId, scope.tenantId, id))
            return reply.code(404).send({ error: "Connection not found." });
        await audit({ tenantId: scope.tenantId, actorUserId: scope.userId, action: "mcp.oauth_revoked", resourceType: "workspace_mcp",
            resourceId: id, requestId: request.id, metadata: {} });
        return reply.code(204).send();
    };
    return { metadata, protectedMetadata, protectedMcpMetadata, register, redirectAuthorization, exchange, revoke, details, approve, deny, connections, disconnect };
}
export function createOAuthErrorHandler() {
    return (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
        const frameworkFailure = frameworkRequestFailure(error);
        if (frameworkFailure)
            return reply.code(frameworkFailure.status).send({ error: frameworkFailure.status === 429 ? "temporarily_unavailable" : "invalid_request", error_description: frameworkFailure.body.error });
        if (error instanceof OAuthRequestError)
            return reply.code(error.status).send({ error: error.code, error_description: error.message });
        if (error instanceof z.ZodError)
            return reply.code(400).send({ error: "invalid_request", error_description: "Invalid authorization request." });
        if ((error as {
            statusCode?: number;
        }).statusCode === 429)
            return reply.code(429).send({ error: "temporarily_unavailable" });
        request.log.warn({ code: "mcp_oauth_failed", errorType: error instanceof Error ? error.name : typeof error }, "MCP authorization request failed");
        return reply.code(503).send({ error: "temporarily_unavailable", error_description: "Authorization is temporarily unavailable." });
    };
}
export function registerMcpOAuthRoutes(app: FastifyInstance, dependencies: {
    oauth: McpOAuth;
    authorize: AuthorizeExplicitMember;
    authorizeUser: AuthorizeMcpUser;
    audit: AuditEventRepository["record"];
}) {
    const handlers = createMcpOAuthHandlers(dependencies);
    app.register(async (routes) => {
        routes.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 8192 }, (_request, body, done) => {
            try {
                done(null, uniqueOAuthParameters(body as string));
            }
            catch (error) {
                done(error as Error);
            }
        });
        routes.setErrorHandler(createOAuthErrorHandler());
        routes.get("/.well-known/oauth-authorization-server", {}, handlers.metadata);
        routes.get("/.well-known/oauth-protected-resource", {}, handlers.protectedMetadata);
        routes.get("/.well-known/oauth-protected-resource/mcp", {}, handlers.protectedMcpMetadata);
        routes.post("/oauth/register", { bodyLimit: 8192, config: { rateLimit: { max: 4, timeWindow: "1 hour" } } }, handlers.register);
        routes.get("/oauth/authorize", { config: { rateLimit: { max: 20 } } }, handlers.redirectAuthorization);
        routes.post("/oauth/token", { bodyLimit: 8192, config: { rateLimit: { max: 30 } } }, handlers.exchange);
        routes.post("/oauth/revoke", { bodyLimit: 1024, config: { rateLimit: { max: 30 } } }, handlers.revoke);
        routes.get<{
            Params: {
                id: string;
            };
        }>("/v1/mcp/oauth/requests/:id", {}, handlers.details);
        routes.post<{
            Params: {
                id: string;
            };
        }>("/v1/mcp/oauth/requests/:id/approve", { bodyLimit: 1024, config: { rateLimit: { max: 10 } } }, handlers.approve);
        routes.post<{
            Params: {
                id: string;
            };
        }>("/v1/mcp/oauth/requests/:id/deny", { bodyLimit: 128, config: { rateLimit: { max: 10 } } }, handlers.deny);
        routes.get("/v1/mcp/connections", {}, handlers.connections);
        routes.delete<{
            Params: {
                id: string;
            };
        }>("/v1/mcp/connections/:id", { config: { rateLimit: { max: 10 } } }, handlers.disconnect);
    });
}
