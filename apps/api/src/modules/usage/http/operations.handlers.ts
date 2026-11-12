import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from "zod";
import { rejectScope, type WorkspaceAuthorizer } from "../../../platform/http/workspace-authorization.js";
import type { BudgetAlertService } from "../application/ports/budget-alert-service.js";
import type { UsageSummary } from "../application/ports/usage-metrics-repository.js";
export type OperationsRoutesDependencies = {
    authorizeOwner: WorkspaceAuthorizer;
    budgetAlerts?: Pick<BudgetAlertService, "status" | "replay" | "configured">;
    getUsageSummary: (tenantId: string, days: number) => Promise<UsageSummary>;
    usageAlertThresholdUsd: () => number;
};
export const OPERATIONS_HTTP = Symbol('operations-http');
export function createOperationsHandlers(dependencies: OperationsRoutesDependencies) {
    const { authorizeOwner } = dependencies;
    const alerts: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const owner = await authorizeOwner(request, true);
        if (!owner.ok)
            return rejectScope(reply, owner);
        return dependencies.budgetAlerts ? dependencies.budgetAlerts.status(owner.tenantId) : reply.code(503).send({ error: 'Budget notifications are unavailable.' });
    };
    const replayAlert: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const owner = await authorizeOwner(request, true);
        if (!owner.ok)
            return rejectScope(reply, owner);
        if (!dependencies.budgetAlerts?.configured)
            return reply.code(503).send({ error: 'Budget notifications are not configured.' });
        const { id } = z.strictObject({ id: z.uuid() }).parse(request.params);
        const { expectedAttempts } = z.strictObject({ expectedAttempts: z.number().int().min(1).max(8) }).parse(request.body);
        const idempotencyKey = z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/).parse(request.headers['idempotency-key']);
        return dependencies.budgetAlerts.replay({ tenantId: owner.tenantId, actorId: owner.userId, id, expectedAttempts, idempotencyKey });
    };
    const usage: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const authorization = await authorizeOwner(request, true);
        if (!authorization.ok)
            return rejectScope(reply, authorization);
        const { days } = z.strictObject({ days: z.coerce.number().int().min(1).max(90).default(30) }).parse(request.query);
        const summary = await dependencies.getUsageSummary(authorization.tenantId, days);
        return { days, summary, alert: { thresholdUsd: dependencies.usageAlertThresholdUsd(), triggered: (summary.effectiveCostUsd ?? summary.estimatedCostUsd) >= dependencies.usageAlertThresholdUsd() } };
    };
    return { alerts, replayAlert, usage };
}
// Compatibility registration is retained for focused transport fixtures only.
export const operationsRoutes: FastifyPluginAsync<OperationsRoutesDependencies> = async (app, dependencies) => {
    const handlers = createOperationsHandlers(dependencies);
    app.get('/v1/admin/alerts', {}, handlers.alerts);
    app.post('/v1/admin/alerts/:id/replay', { bodyLimit: 2048, config: { rateLimit: { max: 6 } } }, handlers.replayAlert);
    app.get("/v1/admin/usage", {}, handlers.usage);
};
