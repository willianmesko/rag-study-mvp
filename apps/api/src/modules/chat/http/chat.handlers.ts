import { chatRunIdSchema, questionComparisonInputSchema, questionInputSchema, questionStreamInputSchema } from "@rag-study/contracts";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from "zod";
import type { QueryScopeResolver } from "../../../platform/http/query-scope.js";
import { withReplySignal } from "../../../platform/http/reply-signal.js";
import { rejectScope, type WorkspaceAuthorizer } from "../../../platform/http/workspace-authorization.js";
import type { WorkspaceWorkflows } from "../../workflows/index.js";
import { openAnswerStream, replayAnswerStream } from ".././http/answer-stream.js";
import { serializeQuestionAnswer, serializeWorkflowEvent } from ".././http/answers.js";
import { modelUnavailable, type ChatModelSelection, type QuestionQuotaConsumer } from ".././http/chat-models.js";
import type { ConversationDelivery } from "../application/conversations/delivery.js";
import type { ChatRunRepository } from "../application/ports/chat-run-repository.js";
import { ConversationError, type ConversationRepository } from "../application/ports/conversation-repository.js";
import type { CompareAnswersUseCase } from "../application/use-cases/compare-answers.js";
import type { StreamAnswerRuns } from "../application/use-cases/stream-answer-runs.js";
const chatRunParams = z.object({ runId: chatRunIdSchema });
const chatRunCursor = z.object({ after: z.coerce.number().int().min(0).max(2147483647).default(0) });
export type ChatRoutesDependencies = {
    authorizeMember: WorkspaceAuthorizer;
    resolveQueryScope: QueryScopeResolver;
    models: ChatModelSelection;
    compareAnswers: Pick<CompareAnswersUseCase, "execute">;
    consumeQuestionQuota: QuestionQuotaConsumer;
    conversations?: Pick<ConversationRepository, "turn">;
    chatRuns: ChatRunRepository;
    workflows?: Pick<WorkspaceWorkflows, "startChat" | "cancel">;
    answerRuns: Pick<StreamAnswerRuns, "start" | "cancel">;
    conversationDelivery?: Pick<ConversationDelivery, "submit">;
    shutdown: AbortSignal;
    questionRateLimitMax: number;
};
export const CHAT_HTTP = Symbol('chat-http');
export function createChatHandlers(dependencies: ChatRoutesDependencies) {
    const { authorizeMember, resolveQueryScope, answerRuns, conversationDelivery } = dependencies;
    const { workspaceChatModels, chooseAnswer } = dependencies.models;
    const compare: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const envelope = z.object({ conversationId: z.uuid().optional(), runId: z.uuid().optional() }).parse(request.body);
        const original = { ...(request.body as Record<string, unknown>) };
        delete original.conversationId;
        delete original.runId;
        const { question, topK, modelIds, promptVariantIds } = questionComparisonInputSchema.parse(original);
        const membership = await authorizeMember(request, true);
        if (!membership.ok)
            return rejectScope(reply, membership);
        if (envelope.conversationId || envelope.runId) {
            if (!envelope.conversationId || !envelope.runId || !conversationDelivery)
                throw new ConversationError('conversation_unavailable', 404);
            const previous = await dependencies.conversations!.turn({ ...membership, conversationId: envelope.conversationId }, envelope.runId);
            if (!previous) {
                const profile = await workspaceChatModels(membership.tenantId);
                if (modelIds.some((id) => !profile.models.has(id)))
                    return reply.code(400).send(modelUnavailable);
            }
            const turn = await conversationDelivery.submit({ ...membership, conversationId: envelope.conversationId, runId: envelope.runId, mode: 'comparison', input: { question, topK, modelIds, promptVariantIds } });
            return reply.code(202).send({ turn });
        }
        const profile = await workspaceChatModels(membership.tenantId);
        const [left, right] = modelIds.map((id) => profile.models.get(id));
        if (!left || !right)
            return reply.code(400).send(modelUnavailable);
        const { tenantId, userId } = membership;
        const actorKey = `user:${userId}`;
        const quota = await dependencies.consumeQuestionQuota(tenantId, actorKey, 2);
        if (!quota.allowed)
            return reply.code(429).send({ error: "Daily question quota reached. Try again tomorrow." });
        return withReplySignal(reply, dependencies.shutdown, async (signal) => {
            const results = await dependencies.compareAnswers.execute({ question, topK, tenantId, actorKey, models: [left, right], promptVariantIds, signal });
            return { results: results.map(({ model, response, ...result }) => ({
                    ...result, model, response: response ? serializeQuestionAnswer(response, model) : null
                })) };
        });
    };
    const answer: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const { question, topK, modelId, previousQuestions } = questionInputSchema.parse(request.body);
        const scope = await resolveQueryScope(request, modelId !== undefined || previousQuestions !== undefined);
        if (!scope.ok)
            return rejectScope(reply, scope);
        const answer = await chooseAnswer(scope.authenticated ? scope.tenantId : undefined, modelId);
        if (!answer)
            return reply.code(modelId ? 400 : 503).send(modelUnavailable);
        const { tenantId, actorKey } = scope;
        const quota = await dependencies.consumeQuestionQuota(tenantId, actorKey);
        if (!quota.allowed)
            return reply.code(429).send({ error: "Daily question quota reached. Try again tomorrow." });
        return withReplySignal(reply, dependencies.shutdown, async (signal) => serializeQuestionAnswer(await answer({ question, ...(previousQuestions ? { previousQuestions } : {}), topK, tenantId, actorKey, signal })));
    };
    const stream: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const { question, topK, runId, modelId, previousQuestions, conversationId } = questionStreamInputSchema.parse(request.body);
        const turn = { question, ...(previousQuestions ? { previousQuestions } : {}), topK };
        if (runId) {
            const membership = await authorizeMember(request, true);
            if (!membership.ok)
                return rejectScope(reply, membership);
            if (conversationId) {
                if (!conversationDelivery || !dependencies.conversations)
                    throw new ConversationError('conversation_unavailable', 404);
                const previous = await dependencies.conversations.turn({ ...membership, conversationId }, runId);
                if (!previous && !await chooseAnswer(membership.tenantId, modelId))
                    return reply.code(modelId ? 400 : 503).send(modelUnavailable);
                const admitted = await conversationDelivery.submit({ ...membership, conversationId, runId, mode: 'answer', input: { question, topK, modelId } });
                if (request.headers.accept === 'application/json')
                    return reply.code(202).send({ turn: admitted });
                const scope = { runId, tenantId: membership.tenantId, actorId: membership.userId };
                if (!await dependencies.chatRuns.get(scope)) {
                    const saved = await dependencies.conversations.turn({ ...membership, conversationId }, runId);
                    if (saved && saved.status !== 'queued' && saved.status !== 'running') {
                        const stream = openAnswerStream(request, reply, dependencies.shutdown);
                        try {
                            const event = saved.answer ? { type: 'completed' as const, response: saved.answer } : saved.status === 'cancelled' ? { type: 'cancelled' as const } : { type: 'error' as const, code: 'execution_failed' as const, error: 'Lumora could not complete this answer.' };
                            await stream.event(event.type, event, 1);
                        }
                        finally {
                            stream.close();
                        }
                        return;
                    }
                }
                return replayAnswerStream(request, reply, dependencies.chatRuns, scope, 0, dependencies.shutdown);
            }
            const answer = await chooseAnswer(membership.tenantId, modelId);
            if (!answer)
                return reply.code(modelId ? 400 : 503).send(modelUnavailable);
            const { tenantId, userId } = membership;
            const actorKey = `user:${userId}`;
            const scope = { runId, tenantId, actorId: userId };
            if (dependencies.workflows) {
                await dependencies.workflows.startChat(scope, { ...turn, modelId });
                return replayAnswerStream(request, reply, dependencies.chatRuns, scope, 0, dependencies.shutdown);
            }
            await answerRuns.start(scope, {
                reserveQuota: async () => (await dependencies.consumeQuestionQuota(tenantId, actorKey)).allowed,
                answer: async ({ signal, publish }) => serializeQuestionAnswer(await answer({
                    ...turn, tenantId, actorKey, signal,
                    onEvent: (event) => publish(serializeWorkflowEvent(event))
                })),
                reportFailure: (error) => request.log.warn({ errorType: error instanceof Error ? error.name : typeof error, runId }, "Answer run execution failed")
            });
            return replayAnswerStream(request, reply, dependencies.chatRuns, scope, 0, dependencies.shutdown);
        }
        const scope = await resolveQueryScope(request, modelId !== undefined || previousQuestions !== undefined);
        if (!scope.ok)
            return rejectScope(reply, scope);
        const answer = await chooseAnswer(scope.authenticated ? scope.tenantId : undefined, modelId);
        if (!answer)
            return reply.code(modelId ? 400 : 503).send(modelUnavailable);
        const { tenantId, actorKey } = scope;
        const quota = await dependencies.consumeQuestionQuota(tenantId, actorKey);
        if (!quota.allowed)
            return reply.code(429).send({ error: "Daily question quota reached. Try again tomorrow." });
        const stream = openAnswerStream(request, reply, dependencies.shutdown);
        try {
            await stream.event("accepted", { status: "accepted" });
            const result = await answer({
                ...turn, tenantId, actorKey, signal: stream.signal,
                onEvent: (event) => {
                    const serialized = serializeWorkflowEvent(event);
                    return stream.event(serialized.type, "sources" in serialized || "delta" in serialized ? serialized : { status: serialized.type });
                }
            });
            await stream.event("completed", serializeQuestionAnswer(result));
        }
        catch (error) {
            if (!stream.signal.aborted) {
                request.log.warn({ errorType: error instanceof Error ? error.name : typeof error }, "Transient answer stream failed");
                await stream.event("error", { error: "Lumora could not prepare an answer. Try again." }).catch(() => undefined);
            }
        }
        finally {
            stream.close();
        }
    };
    const replay: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const { runId } = chatRunParams.parse(request.params);
        const { after } = chatRunCursor.parse(request.query);
        const membership = await authorizeMember(request, true);
        if (!membership.ok)
            return rejectScope(reply, membership);
        const scope = { runId, tenantId: membership.tenantId, actorId: membership.userId };
        return replayAnswerStream(request, reply, dependencies.chatRuns, scope, after, dependencies.shutdown);
    };
    const cancel: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const { runId } = chatRunParams.parse(request.params);
        const membership = await authorizeMember(request, true);
        if (!membership.ok)
            return rejectScope(reply, membership);
        const scope = { runId, tenantId: membership.tenantId, actorId: membership.userId };
        await dependencies.workflows?.cancel(scope);
        const status = await answerRuns.cancel(scope);
        if (!status)
            return reply.code(404).send({ error: "This answer session is no longer available." });
        return { status };
    };
    return { compare, answer, stream, replay, cancel };
}
// Compatibility registration is retained for focused transport fixtures only.
export const chatRoutes: FastifyPluginAsync<ChatRoutesDependencies> = async (app, dependencies) => {
    const handlers = createChatHandlers(dependencies);
    app.post("/v1/qa/compare", { config: { rateLimit: { max: dependencies.questionRateLimitMax } } }, handlers.compare);
    app.post("/v1/qa", { config: { rateLimit: { max: dependencies.questionRateLimitMax } } }, handlers.answer);
    app.post("/v1/qa/stream", { config: { rateLimit: { max: dependencies.questionRateLimitMax } } }, handlers.stream);
    app.get("/v1/qa/runs/:runId/events", { exposeHeadRoute: false }, handlers.replay);
    app.post("/v1/qa/runs/:runId/cancel", {}, handlers.cancel);
};
