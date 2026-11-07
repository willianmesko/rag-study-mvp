import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AgentActionError, agentActionIdempotencyKeySchema, type AgentActionService } from "../../application/agent-actions/agent-action-service.js";
import type { AuthorizeExplicitMember } from "./workspace-mcp.js";

export type AgentActions = Pick<AgentActionService, "request" | "approve" | "get">;
const approvalInput = z.strictObject({ approve: z.literal(true) });
const errors = { forbidden: 403, not_found: 404, conflict: 409, rate_limited: 429 } as const;

export function registerAgentActionRoutes(app: FastifyInstance, actions: AgentActions, authorize: AuthorizeExplicitMember) {
  async function asOwner(request: FastifyRequest, reply: FastifyReply, run: (owner: {
    tenantId: string; userId: string; role: "owner";
  }) => Promise<unknown>) {
    const scope = await authorize(request);
    if (!scope.ok) return reply.code(scope.status).send({ code: scope.code, error: scope.error });
    if (scope.role !== "owner") return reply.code(403).send({ code: "forbidden", error: "Workspace owner access is required." });
    try {
      return await run({ ...scope, role: scope.role });
    } catch (error) {
      if (error instanceof AgentActionError) return reply.code(errors[error.code]).send({ code: error.code, error: error.message });
      throw error;
    }
  }

  app.post("/v1/agent-actions", { bodyLimit: 512, config: { rateLimit: { max: 6 } } }, async (request, reply) =>
    asOwner(request, reply, async (owner) => {
      const idempotencyKey = agentActionIdempotencyKeySchema.parse(request.headers["idempotency-key"]);
      const action = await actions.request({ ...owner, idempotencyKey, input: request.body });
      return reply.code(202).send({ action });
    }));
  app.post<{ Params: { actionId: string } }>("/v1/agent-actions/:actionId/approve", {
    bodyLimit: 512, config: { rateLimit: { max: 6 } }
  }, async (request, reply) => asOwner(request, reply, async (owner) => {
    approvalInput.parse(request.body);
    const action = await actions.approve({ ...owner, actionId: z.uuid().parse(request.params.actionId) });
    return reply.code(202).send({ action });
  }));
  app.get<{ Params: { actionId: string } }>("/v1/agent-actions/:actionId", async (request, reply) =>
    asOwner(request, reply, async (owner) => ({
      action: await actions.get({ ...owner, actionId: z.uuid().parse(request.params.actionId) })
    })));
}
