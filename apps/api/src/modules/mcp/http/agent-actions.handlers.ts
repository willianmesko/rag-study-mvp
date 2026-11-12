import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from "zod";
import type { ExplicitWorkspaceAuthorizer as AuthorizeExplicitMember } from "../../../platform/http/workspace-authorization.js";
import { AgentActionError, agentActionIdempotencyKeySchema, type AgentActionService } from "../application/agent-actions/agent-action-service.js";
export type AgentActions = Pick<AgentActionService, "request" | "approve" | "get">;
const approvalInput = z.strictObject({ approve: z.literal(true) });
const errors = { forbidden: 403, not_found: 404, conflict: 409, rate_limited: 429 } as const;
export type AgentActionRoutesDependencies = {
    actions: AgentActions;
    authorize: AuthorizeExplicitMember;
};
export const AGENT_ACTIONS_HTTP = Symbol('agent_actions_http');
export function createAgentActionsHandlers(dependencies: AgentActionRoutesDependencies) {
    const { actions, authorize } = dependencies;
    async function asOwner(request: FastifyRequest, reply: FastifyReply, run: (owner: {
        tenantId: string;
        userId: string;
        role: "owner";
    }) => Promise<unknown>) {
        const scope = await authorize(request);
        if (!scope.ok)
            return reply.code(scope.status).send({ code: scope.code, error: scope.error });
        if (scope.role !== "owner")
            return reply.code(403).send({ code: "forbidden", error: "Workspace owner access is required." });
        try {
            return await run({ ...scope, role: scope.role });
        }
        catch (error) {
            if (error instanceof AgentActionError)
                return reply.code(errors[error.code]).send({ code: error.code, error: error.message });
            throw error;
        }
    }
    const requestAction: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => asOwner(request, reply, async (owner) => {
        const idempotencyKey = agentActionIdempotencyKeySchema.parse(request.headers["idempotency-key"]);
        const action = await actions.request({ ...owner, idempotencyKey, input: request.body });
        return reply.code(202).send({ action });
    });
    const approve: (request: FastifyRequest<{
        Params: {
            actionId: string;
        };
    }>, reply: FastifyReply) => Promise<unknown> = async (request, reply) => asOwner(request, reply, async (owner) => {
        approvalInput.parse(request.body);
        const action = await actions.approve({ ...owner, actionId: z.uuid().parse(request.params.actionId) });
        return reply.code(202).send({ action });
    });
    const get: (request: FastifyRequest<{
        Params: {
            actionId: string;
        };
    }>, reply: FastifyReply) => Promise<unknown> = async (request, reply) => asOwner(request, reply, async (owner) => ({
        action: await actions.get({ ...owner, actionId: z.uuid().parse(request.params.actionId) })
    }));
    return { requestAction, approve, get };
}
export function registerAgentActionRoutes(app: FastifyInstance, actions: AgentActions, authorize: AuthorizeExplicitMember) {
    const handlers = createAgentActionsHandlers({ actions, authorize });
    app.post("/v1/agent-actions", { bodyLimit: 512, config: { rateLimit: { max: 6 } } }, handlers.requestAction);
    app.post<{
        Params: {
            actionId: string;
        };
    }>("/v1/agent-actions/:actionId/approve", {
        bodyLimit: 512, config: { rateLimit: { max: 6 } }
    }, handlers.approve);
    app.get<{
        Params: {
            actionId: string;
        };
    }>("/v1/agent-actions/:actionId", {}, handlers.get);
}
