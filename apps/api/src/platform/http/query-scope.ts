import type { FastifyRequest } from "fastify";
import type { ScopeFailure, WorkspaceAuthorizer } from "./workspace-authorization.js";

type QueryScope = { ok: true; tenantId: string; actorKey: string; authenticated: boolean };
export type QueryScopeResolver = (request: FastifyRequest, requireExplicitWorkspace?: boolean) => Promise<QueryScope | ScopeFailure>;

export function createQueryScopeResolver(dependencies: {
  authorizeMember: WorkspaceAuthorizer;
  requiresProductionAuth: () => boolean;
  anonymousScope: (request: FastifyRequest) => { tenantId: string; actorKey: string };
}): QueryScopeResolver {
  return async (request, requireExplicitWorkspace = false) => {
    if (requireExplicitWorkspace || (typeof request.headers.authorization === "string" && request.headers.authorization.startsWith("Bearer "))) {
      const membership = await dependencies.authorizeMember(request, requireExplicitWorkspace);
      if (!membership.ok) return membership;
      return { ok: true, tenantId: membership.tenantId, actorKey: `user:${membership.userId}`, authenticated: true };
    }
    const requestsPrivateAccess = request.headers.authorization !== undefined || request.headers["x-workspace-id"] !== undefined;
    if (requestsPrivateAccess || dependencies.requiresProductionAuth()) return { ok: false, status: 401, error: "Authentication required." };
    return { ok: true, ...dependencies.anonymousScope(request), authenticated: false };
  };
}
