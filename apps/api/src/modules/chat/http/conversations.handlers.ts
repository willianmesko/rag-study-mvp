import { conversationCreateSchema, conversationFeedbackSchema, conversationRenameSchema, } from "@rag-study/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from "zod";
import type { ExplicitWorkspaceAuthorizer as AuthorizeExplicitMember } from "../../../platform/http/workspace-authorization.js";
import type { AuditEventRepository } from "../../usage/index.js";
import type { ConversationDelivery } from "../application/conversations/delivery.js";
import type { ConversationRepository } from "../application/ports/conversation-repository.js";
export type ConversationRoutesDependencies = {
    records: ConversationRepository;
    authorize: AuthorizeExplicitMember;
    delivery: ConversationDelivery;
    audit: AuditEventRepository["record"];
    shutdown: AbortSignal;
    cancel: (scope: {
        tenantId: string;
        actorId: string;
        runId: string;
    }) => Promise<unknown>;
};
export const CONVERSATIONS_HTTP = Symbol('conversations_http');
export function createConversationsHandlers(deps: ConversationRoutesDependencies, logger: Pick<FastifyInstance, "log">) {
    const { records, authorize, delivery } = deps;
    const scopeParams = z.object({ id: z.uuid() });
    const pagination = z.strictObject({
        limit: z.coerce.number().int().min(1).max(50).default(20),
        cursor: z.string().min(1).max(300).optional(),
    });
    const messagesPage = z.strictObject({
        limit: z.coerce.number().int().min(1).max(50).default(25),
        before: z.coerce.number().int().min(1).max(501).optional(),
    });
    const owner = async (request: Parameters<AuthorizeExplicitMember>[0]) => {
        const result = await authorize(request);
        return result.ok ? { ...result, userId: result.userId } : result;
    };
    let timer: ReturnType<typeof setInterval> | undefined, processing: Promise<void> | undefined;
    const tick = () => {
        if (processing || deps.shutdown.aborted)
            return;
        processing = delivery
            .recover()
            .catch(() => logger.log.warn({ code: "conversation_recovery_failed" }, "Conversation recovery failed"))
            .finally(() => {
            processing = undefined;
        });
    };
    const start = async () => {
        tick();
        timer = setInterval(tick, 2000);
        timer.unref();
    };
    const close = async () => {
        if (timer)
            clearInterval(timer);
        await processing;
        await delivery.close();
    };
    const list: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const user = await owner(request);
        if (!user.ok)
            return reply
                .code(user.status)
                .send({ code: user.code, error: user.error });
        const page = pagination.parse(request.query);
        return records.list(user, page.limit, page.cursor);
    };
    const create: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const user = await owner(request);
        if (!user.ok)
            return reply
                .code(user.status)
                .send({ code: user.code, error: user.error });
        const input = conversationCreateSchema.parse(request.body), conversation = await records.create(user, input.id, input.title);
        await deps.audit({
            tenantId: user.tenantId,
            actorUserId: user.userId,
            action: "conversation.created",
            resourceType: "conversation",
            resourceId: conversation.id,
            requestId: request.id,
            metadata: {},
        });
        return reply.code(201).send({ conversation });
    };
    const deleteAll: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const user = await owner(request);
        if (!user.ok)
            return reply
                .code(user.status)
                .send({ code: user.code, error: user.error });
        await records.deleteAll(user);
        await deps.audit({
            tenantId: user.tenantId,
            actorUserId: user.userId,
            action: "conversation.deleted",
            resourceType: "conversation",
            resourceId: null,
            requestId: request.id,
            metadata: { all: true },
        });
        return reply.code(204).send();
    };
    const messages: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const user = await owner(request);
        if (!user.ok)
            return reply
                .code(user.status)
                .send({ code: user.code, error: user.error });
        const { id } = scopeParams.parse(request.params), page = messagesPage.parse(request.query);
        return records.messages({ ...user, conversationId: id }, page.limit, page.before);
    };
    const rename: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const user = await owner(request);
        if (!user.ok)
            return reply
                .code(user.status)
                .send({ code: user.code, error: user.error });
        const { id } = scopeParams.parse(request.params), { title } = conversationRenameSchema.parse(request.body);
        const conversation = await records.rename({ ...user, conversationId: id }, title);
        await deps.audit({
            tenantId: user.tenantId,
            actorUserId: user.userId,
            action: "conversation.renamed",
            resourceType: "conversation",
            resourceId: id,
            requestId: request.id,
            metadata: {},
        });
        return { conversation };
    };
    const remove: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const user = await owner(request);
        if (!user.ok)
            return reply
                .code(user.status)
                .send({ code: user.code, error: user.error });
        const { id } = scopeParams.parse(request.params);
        await records.delete({ ...user, conversationId: id });
        await deps.audit({
            tenantId: user.tenantId,
            actorUserId: user.userId,
            action: "conversation.deleted",
            resourceType: "conversation",
            resourceId: id,
            requestId: request.id,
            metadata: {},
        });
        return reply.code(204).send();
    };
    const feedback: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const user = await owner(request);
        if (!user.ok)
            return reply
                .code(user.status)
                .send({ code: user.code, error: user.error });
        const { id, messageId } = scopeParams
            .extend({ messageId: z.uuid() })
            .parse(request.params), { value } = conversationFeedbackSchema.parse(request.body);
        await records.feedback({ ...user, conversationId: id }, messageId, value);
        await deps.audit({
            tenantId: user.tenantId,
            actorUserId: user.userId,
            action: "conversation.feedback",
            resourceType: "conversation",
            resourceId: id,
            requestId: request.id,
            metadata: { messageId, rating: value },
        });
        return reply.code(204).send();
    };
    const turn: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const user = await owner(request);
        if (!user.ok)
            return reply
                .code(user.status)
                .send({ code: user.code, error: user.error });
        const { id, runId } = scopeParams
            .extend({ runId: z.uuid() })
            .parse(request.params), turn = await records.turn({ ...user, conversationId: id }, runId);
        return turn
            ? { turn }
            : reply
                .code(404)
                .send({ error: "This conversation message is no longer available." });
    };
    const cancel: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const user = await owner(request);
        if (!user.ok)
            return reply
                .code(user.status)
                .send({ code: user.code, error: user.error });
        const { id, runId } = scopeParams
            .extend({ runId: z.uuid() })
            .parse(request.params), scope = { ...user, conversationId: id };
        if (!(await records.turn(scope, runId)))
            return reply
                .code(404)
                .send({ error: "This conversation message is no longer available." });
        await deps.cancel({
            tenantId: user.tenantId,
            actorId: user.userId,
            runId,
        });
        await records.cancelPending(scope, runId);
        return { turn: await records.turn(scope, runId) };
    };
    return { list, create, deleteAll, messages, rename, remove, feedback, turn, cancel, start, close };
}
export function registerConversationRoutes(app: FastifyInstance, deps: {
    records: ConversationRepository;
    authorize: AuthorizeExplicitMember;
    delivery: ConversationDelivery;
    audit: AuditEventRepository["record"];
    shutdown: AbortSignal;
    cancel: (scope: {
        tenantId: string;
        actorId: string;
        runId: string;
    }) => Promise<unknown>;
}) {
    const handlers = createConversationsHandlers(deps, app);
    app.get("/v1/conversations", {}, handlers.list);
    app.post("/v1/conversations", { bodyLimit: 1024, config: { rateLimit: { max: 10 } } }, handlers.create);
    app.delete("/v1/conversations", {}, handlers.deleteAll);
    app.get("/v1/conversations/:id/messages", {}, handlers.messages);
    app.patch("/v1/conversations/:id", { bodyLimit: 1024 }, handlers.rename);
    app.delete("/v1/conversations/:id", {}, handlers.remove);
    app.put("/v1/conversations/:id/messages/:messageId/feedback", { bodyLimit: 128, config: { rateLimit: { max: 30 } } }, handlers.feedback);
    app.get("/v1/conversations/:id/runs/:runId", {}, handlers.turn);
    app.post("/v1/conversations/:id/runs/:runId/cancel", {}, handlers.cancel);
    app.addHook("onReady", handlers.start);
    app.addHook("preClose", handlers.close);
}
