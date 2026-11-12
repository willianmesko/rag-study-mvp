import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from "zod";
import type { QueryScopeResolver } from "../../../platform/http/query-scope.js";
import { withReplySignal } from "../../../platform/http/reply-signal.js";
import { rejectScope } from "../../../platform/http/workspace-authorization.js";
import { withProviderUsageScope } from "../../../platform/observability/provider-usage-context.js";
import { restrictedPassagePreview } from ".././http/passages.js";
import type { KnowledgeStatusRepository } from "../application/ports/knowledge-status-repository.js";
import type { SearchDocumentsUseCase } from "../application/use-cases/search-documents.js";
const searchSchema = z.object({ q: z.string().min(1).max(5000), topK: z.coerce.number().int().min(1).max(20).optional() });
export type SearchRoutesDependencies = {
    resolveQueryScope: QueryScopeResolver;
    knowledgeStatus: Pick<KnowledgeStatusRepository, "get">;
    searchDocuments: Pick<SearchDocumentsUseCase, "execute">;
    shutdown: AbortSignal;
};
export const SEARCH_HTTP = Symbol('search-http');
export function createSearchHandlers(dependencies: SearchRoutesDependencies) {
    const { resolveQueryScope } = dependencies;
    const status: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        z.strictObject({}).parse(request.query);
        // Private requests always name their workspace. Anonymous demo requests
        // can only inspect the configured public corpus, never a supplied tenant.
        const privateRequest = request.headers.authorization !== undefined || request.headers["x-workspace-id"] !== undefined;
        const scope = await resolveQueryScope(request, privateRequest);
        if (!scope.ok)
            return rejectScope(reply, scope);
        return dependencies.knowledgeStatus.get(scope.tenantId);
    };
    const search: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (request, reply) => {
        const { q, topK } = searchSchema.parse(request.query);
        const scope = await resolveQueryScope(request);
        if (!scope.ok)
            return rejectScope(reply, scope);
        const results = await withReplySignal(reply, dependencies.shutdown, (signal) => withProviderUsageScope({ tenantId: scope.tenantId, actorKey: scope.actorKey }, () => dependencies.searchDocuments.execute({ query: q, topK, tenantId: scope.tenantId, signal })));
        return { results: results.map(({ content, ...result }) => {
                const { excerpt, excerptTruncated, previewBlocked } = restrictedPassagePreview(content, result.security);
                return { ...result, content: excerpt, previewTruncated: excerptTruncated, previewBlocked };
            }) };
    };
    return { status, search };
}
// Compatibility registration is retained for focused transport fixtures only.
export const searchRoutes: FastifyPluginAsync<SearchRoutesDependencies> = async (app, dependencies) => {
    const handlers = createSearchHandlers(dependencies);
    app.get("/v1/knowledge/status", {}, handlers.status);
    app.get("/v1/search", {}, handlers.search);
};
