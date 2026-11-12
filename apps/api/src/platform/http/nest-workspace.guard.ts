import { HttpException, Inject, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import type { UserAuthorizer, WorkspaceAuthorizer } from "./workspace-authorization.js";
export const HTTP_TRANSPORT_LOGGER = Symbol("http-transport-logger");
export const HTTP_AUTHORIZATION = Symbol("http-authorization");
const ACCESS = Symbol("workspace-access");
type Access = {
    role: "user" | "member" | "admin" | "owner" | "handler";
    explicit: boolean;
};
export const WorkspaceAccess = (access: Access) => SetMetadata(ACCESS, access);
export type HttpAuthorization = {
    user: UserAuthorizer;
    member: WorkspaceAuthorizer;
    admin: WorkspaceAuthorizer;
    owner: WorkspaceAuthorizer;
};
/** Only this trusted exception may return an authorization response verbatim. */
export class HttpAccessDenied extends HttpException {
    constructor(status: number, body: object) { super(body, status); }
}
@Injectable()
export class WorkspaceRoleGuard implements CanActivate {
    constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(HTTP_AUTHORIZATION)
    private readonly authorization: HttpAuthorization) { }
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const policy = this.reflector.getAllAndOverride<Access | undefined>(ACCESS, [context.getHandler(), context.getClass()]);
        // Conditional demo/legacy/MCP authority is checked by its specialized handler.
        // Do not reorder its validation or silently replace its credential protocol.
        if (!policy)
            throw new Error("Workspace access policy is missing.");
        if (policy.role === "handler")
            return true;
        const request = context.switchToHttp().getRequest<FastifyRequest>();
        const result = policy.role === "user" ? await this.authorization.user(request)
            : await this.authorization[policy.role](request, policy.explicit);
        if (result.ok)
            return true;
        throw new HttpAccessDenied(result.status, { error: result.error, code: result.code });
    }
}
