import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { IdentityRequest, IdentityVerification, RequestIdentity } from "../../modules/identity/index.js";
import type { TenantMembership, TenantMembershipRepository, TenantRole } from "../../modules/workspaces/index.js";
const workspaceIdSchema = z.string().uuid();
const workspaceRequired = { ok: false, status: 400, error: "Select a workspace.", code: "workspace_required" } as const;
export type ScopeFailure = {
    ok: false;
    status: number;
    error: string;
    code?: "workspace_required" | "invalid_workspace" | "authentication_timeout" | "authentication_unavailable";
};
export type WorkspacePrincipal = {
    ok: true;
    userId: string;
    tenantId: string;
    role: TenantRole;
};
export type ExplicitWorkspaceAuthorizer = (request: FastifyRequest) => Promise<WorkspacePrincipal | {
    ok: false;
    status: number;
    error: string;
    code?: string;
}>;
export type WorkspaceAuthorizer = (request: IdentityRequest, requireExplicitWorkspace?: boolean) => Promise<WorkspacePrincipal | ScopeFailure>;
export type UserAuthorizer = (request: IdentityRequest) => Promise<{
    ok: true;
    userId: string;
} | ScopeFailure>;
export function identityFailure(identity: Extract<IdentityVerification, {
    ok: false;
}>, options: {
    invalidError: string;
    notConfiguredError: string;
    invalidStatus?: number;
}): ScopeFailure {
    if (identity.reason === "missing_session")
        return { ok: false, status: 401, error: "Authentication required." };
    if (identity.reason === "not_configured")
        return { ok: false, status: 503, error: options.notConfiguredError };
    if (identity.reason === "invalid_session")
        return { ok: false, status: options.invalidStatus ?? 403, error: options.invalidError };
    return identity.reason === "timeout"
        ? { ok: false, status: 504, code: "authentication_timeout", error: "Authentication timed out. Try again." }
        : { ok: false, status: 503, code: "authentication_unavailable", error: "Authentication is temporarily unavailable." };
}
export function rejectScope(reply: FastifyReply, failure: ScopeFailure) {
    return reply.code(failure.status).send({ error: failure.error, code: failure.code });
}
export function createWorkspaceAuthorization(dependencies: {
    identity: Pick<RequestIdentity, "verify">;
    isConfigured: () => boolean;
    findMembership: TenantMembershipRepository["findByUserAndTenant"];
    listMemberships: TenantMembershipRepository["listByUserId"];
}) {
    const user: UserAuthorizer = async (request) => {
        if (!dependencies.isConfigured())
            return { ok: false, status: 503, error: "Workspace access is not configured." };
        const identity = await dependencies.identity.verify(request);
        return identity.ok ? identity : identityFailure(identity, { invalidError: "Authentication required.", notConfiguredError: "Workspace access is not configured." });
    };
    const member: WorkspaceAuthorizer = async (request, requireExplicitWorkspace = false) => {
        if (!dependencies.isConfigured())
            return { ok: false, status: 503, error: "Admin upload is not configured." };
        const authorization = request.headers.authorization;
        const token = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : undefined;
        if (!token)
            return { ok: false, status: 401, error: "Authentication required." };
        const workspaceHeader = request.headers["x-workspace-id"];
        const requestedWorkspace = workspaceHeader === undefined ? undefined : workspaceIdSchema.safeParse(workspaceHeader);
        if (requestedWorkspace && !requestedWorkspace.success)
            return { ok: false, status: 400, error: "Select a valid workspace.", code: "invalid_workspace" };
        if (requireExplicitWorkspace && !requestedWorkspace)
            return workspaceRequired;
        const identity = await dependencies.identity.verify(request);
        if (!identity.ok)
            return identityFailure(identity, { invalidError: "Administrator access required.", notConfiguredError: "Admin upload is not configured." });
        let membership: TenantMembership | null | undefined;
        if (requestedWorkspace) {
            membership = await dependencies.findMembership(identity.userId, requestedWorkspace.data);
        }
        else {
            const memberships = await dependencies.listMemberships(identity.userId, 2);
            if (memberships.length > 1)
                return workspaceRequired;
            membership = memberships[0];
        }
        if (!membership)
            return { ok: false, status: 403, error: "Workspace membership required." };
        return { ok: true, userId: identity.userId, tenantId: membership.tenantId, role: membership.role };
    };
    const admin: WorkspaceAuthorizer = async (request, requireExplicitWorkspace = false) => {
        const authorization = await member(request, requireExplicitWorkspace);
        if (!authorization.ok)
            return authorization;
        return authorization.role === "viewer" ? { ok: false, status: 403, error: "Editor or owner access required." } : authorization;
    };
    const owner: WorkspaceAuthorizer = async (request, requireExplicitWorkspace = false) => {
        const authorization = await member(request, requireExplicitWorkspace);
        if (!authorization.ok)
            return authorization;
        return authorization.role !== "owner" ? { ok: false, status: 403, error: "Workspace owner access required." } : authorization;
    };
    // Share one authorization decision within a single request. Never cache a
    // membership or role across requests: revocation must be visible immediately.
    const decisions = new WeakMap<IdentityRequest, Map<string, ReturnType<WorkspaceAuthorizer>>>();
    const cached = (name: string, authorize: WorkspaceAuthorizer): WorkspaceAuthorizer => (request, explicit = false) => {
        let entries = decisions.get(request);
        if (!entries) {
            entries = new Map();
            decisions.set(request, entries);
        }
        const key = `${name}:${explicit}`;
        let result = entries.get(key);
        if (!result) {
            result = authorize(request, explicit);
            entries.set(key, result);
        }
        return result;
    };
    return { user, member: cached("member", member), admin: cached("admin", admin), owner: cached("owner", owner) };
}
