import { maxMcpReadResponseBytes, mcpAccessTokenSchema, mcpReadToolNameSchema, mcpReadToolOutputSchemas, mcpWorkspaceIdSchema } from "@rag-study/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from "zod";
import { withReplySignal } from "../../../platform/http/reply-signal.js";
import type { ExplicitWorkspaceAuthorizer as AuthorizeExplicitMember } from "../../../platform/http/workspace-authorization.js";
import type { AuditEventRepository } from "../../usage/index.js";
import type { TenantRole } from "../../workspaces/index.js";
import type { McpAccess } from "../application/access.js";
import { McpBudgetExceededError, McpIndexUnavailableError } from "../application/hybrid-search.js";
import { assertToolAllowed, readOnlyWorkspaceTools, withExecutionTimeout } from "../application/policies/agent-execution-policy.js";
import { McpReadToolForbiddenError, type McpReadTools } from "../application/read-tools.js";
import type { McpCallControls } from "../application/remote-types.js";
type Member = {
    tenantId: string;
    userId: string;
    role: TenantRole;
};
export type WorkspaceMcp = {
    access: Pick<McpAccess, "issue" | "status" | "revoke" | "admit" | "validate">;
    tools: Pick<McpReadTools, "execute">;
    controls: Pick<McpCallControls, "admit">;
};
type ToolFailure = {
    status: number;
    code: string;
    error: string;
};
const denied = { status: 403, code: "tool_forbidden", error: "This tool is not available to your workspace role." };
const invalidInput = { status: 400, code: "invalid_input", error: "The tool arguments are invalid." };
const timedOut = { status: 504, code: "tool_timeout", error: "The workspace tool exceeded its time limit." };
const failed = { status: 503, code: "tool_unavailable", error: "The workspace tool could not complete." };
function replyFailure(reply: FastifyReply, { status, code, error }: ToolFailure) {
    return reply.code(status).send({ code, error });
}
export type WorkspaceMcpRoutesDependencies = WorkspaceMcp & {
    authorize: AuthorizeExplicitMember;
    audit: AuditEventRepository["record"];
    shutdown: AbortSignal;
};
export const WORKSPACE_MCP_HTTP = Symbol('workspace_mcp_http');
export function createWorkspaceMcpHandlers(dependencies: WorkspaceMcpRoutesDependencies) {
    const { access, tools, controls, authorize, audit, shutdown } = dependencies;
    function authorizeUser(request: FastifyRequest): ReturnType<AuthorizeExplicitMember> {
        if (request.headers.authorization?.startsWith("Bearer lumora_mcp_")) {
            return Promise.resolve({ ok: false as const, status: 401, error: "Sign in to manage MCP access." });
        }
        return authorize(request);
    }
    function record(scope: Member, request: FastifyRequest, action: "mcp.access_issued" | "mcp.access_revoked" | "mcp.tool_called", metadata: {
        tool?: string;
        outcome?: string;
    } = {}) {
        return audit({
            tenantId: scope.tenantId, actorUserId: scope.userId, requestId: request.id, action,
            resourceType: "workspace_mcp", resourceId: null, metadata
        });
    }
    const status: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const scope = await authorizeUser(request);
        if (!scope.ok)
            return reply.code(scope.status).send({ code: scope.code, error: scope.error });
        return access.status(scope);
    };
    const issue: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const scope = await authorizeUser(request);
        if (!scope.ok)
            return reply.code(scope.status).send({ code: scope.code, error: scope.error });
        const credential = await access.issue(scope);
        await record(scope, request, "mcp.access_issued");
        return reply.code(201).send(credential);
    };
    const revoke: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const scope = await authorizeUser(request);
        if (!scope.ok)
            return reply.code(scope.status).send({ code: scope.code, error: scope.error });
        await access.revoke(scope);
        await record(scope, request, "mcp.access_revoked");
        return reply.code(204).send();
    };
    const callTool: (request: FastifyRequest<{
        Params: {
            tool: string;
        };
    }>, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const authorization = request.headers.authorization;
        const token = mcpAccessTokenSchema.safeParse(authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined);
        if (!token.success)
            return replyFailure(reply, { status: 401, code: "mcp_access_required", error: "A temporary MCP credential is required." });
        const workspace = mcpWorkspaceIdSchema.safeParse(request.headers["x-workspace-id"]);
        if (!workspace.success)
            return replyFailure(reply, { status: 400, code: "workspace_required", error: "Select a valid workspace." });
        return withReplySignal(reply, shutdown, async (callerSignal) => {
            const scope = await withExecutionTimeout(() => access.admit(workspace.data, token.data), 4000, callerSignal);
            if (!scope)
                return replyFailure(reply, { status: 401, code: "mcp_access_required", error: "The temporary MCP credential is invalid or expired." });
            const name = mcpReadToolNameSchema.safeParse(request.params.tool);
            const auditTool = name.success ? name.data : "unknown";
            const deadline = AbortSignal.timeout(5000);
            const signal = AbortSignal.any([callerSignal, deadline]);
            let outcome: ToolFailure | undefined;
            let result: unknown;
            if (!scope.allowed || !await controls.admit(scope.tenantId, scope.userId, signal)) {
                outcome = { status: 429, code: "tool_limit_reached", error: "The workspace MCP call limit was reached." };
            }
            else if (!name.success || (name.data === "get_quality_report" && scope.role !== "owner")) {
                outcome = denied;
            }
            else {
                const revoked = new AbortController();
                const callSignal = AbortSignal.any([signal, revoked.signal]);
                let checking = false;
                const stillAllowed = async () => {
                    const current = await access.validate(scope.tenantId, token.data);
                    return Boolean(current && current.userId === scope.userId && (name.data !== "get_quality_report" || current.role === "owner"));
                };
                const timer = setInterval(() => {
                    if (checking || callSignal.aborted)
                        return;
                    checking = true;
                    void stillAllowed().then((valid) => {
                        if (!valid)
                            revoked.abort();
                    }).catch(() => revoked.abort()).finally(() => { checking = false; });
                }, 250);
                timer.unref();
                try {
                    if (!await stillAllowed())
                        throw new McpReadToolForbiddenError();
                    assertToolAllowed(name.data, readOnlyWorkspaceTools, { maxToolCalls: 1 }, 0);
                    const value = await withExecutionTimeout((boundedSignal) => tools.execute({ tool: name.data, tenantId: scope.tenantId, userId: scope.userId, role: scope.role,
                        arguments: request.body === undefined ? {} : request.body, signal: boundedSignal }), 5000, callSignal);
                    callSignal.throwIfAborted();
                    if (!await stillAllowed())
                        throw new McpReadToolForbiddenError();
                    const parsed = mcpReadToolOutputSchemas[name.data].safeParse(value);
                    if (!parsed.success || Buffer.byteLength(JSON.stringify({ result: parsed.data })) > maxMcpReadResponseBytes) {
                        outcome = failed;
                    }
                    else {
                        result = parsed.data;
                    }
                }
                catch (error) {
                    if (callerSignal.aborted || revoked.signal.aborted)
                        outcome = { status: 499, code: "tool_cancelled", error: "The workspace tool was cancelled." };
                    else if (deadline.aborted)
                        outcome = timedOut;
                    else if (error instanceof ZodError)
                        outcome = invalidInput;
                    else if (error instanceof McpReadToolForbiddenError)
                        outcome = denied;
                    else if (error instanceof McpBudgetExceededError)
                        outcome = { status: 429, code: "provider_budget_exceeded", error: error.message };
                    else if (error instanceof McpIndexUnavailableError)
                        outcome = { status: 409, code: "index_unavailable", error: error.message };
                    else {
                        request.log.warn({ tool: auditTool, errorType: error instanceof Error ? error.name : typeof error }, "Workspace MCP tool failed");
                        outcome = failed;
                    }
                }
                finally {
                    clearInterval(timer);
                }
            }
            await record(scope, request, "mcp.tool_called", { tool: auditTool, outcome: outcome?.code ?? "completed" });
            if (outcome)
                return replyFailure(reply, outcome);
            return { result };
        });
    };
    return { status, issue, revoke, callTool };
}
export function registerWorkspaceMcpRoutes(app: FastifyInstance, dependencies: WorkspaceMcp & {
    authorize: AuthorizeExplicitMember;
    audit: AuditEventRepository["record"];
    shutdown: AbortSignal;
}) {
    const handlers = createWorkspaceMcpHandlers(dependencies);
    app.get("/v1/mcp/access", {}, handlers.status);
    app.post("/v1/mcp/access", { bodyLimit: 256, config: { rateLimit: { max: 4 } } }, handlers.issue);
    app.delete("/v1/mcp/access", { config: { rateLimit: { max: 4 } } }, handlers.revoke);
    app.post<{
        Params: {
            tool: string;
        };
    }>("/v1/mcp/tools/:tool", { bodyLimit: 2048 }, handlers.callTool);
}
