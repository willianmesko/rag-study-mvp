import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { workspaceMemberRoleSchema } from "@rag-study/contracts";
import type { MemberDirectory } from "../identity/index.js";
import type { TenantMembershipRepository } from "./application/ports/tenant-membership-repository.js";
import type { InviteWorkspaceMember } from "./application/integrations/workspace-invitations.js";
import { rejectScope, type WorkspaceAuthorizer } from "../../platform/http/workspace-authorization.js";
import { withReplySignal } from "../../platform/http/reply-signal.js";

const invitationSchema = z.object({ email: z.string().email().max(320).transform((value) => value.trim().toLowerCase()), role: workspaceMemberRoleSchema });
const memberRoleSchema = z.object({ role: workspaceMemberRoleSchema });

export type WorkspaceTeamRoutesDependencies = {
  authorizeOwner: WorkspaceAuthorizer;
  memberDirectory: MemberDirectory;
  listWorkspaceMembers: TenantMembershipRepository["listMembers"];
  changeWorkspaceMemberRole: TenantMembershipRepository["changeMemberRole"];
  removeWorkspaceMember: TenantMembershipRepository["removeMember"];
  inviteWorkspaceMember?: Pick<InviteWorkspaceMember, "execute">;
  listInvitationDeliveries?: (tenantId: string) => Promise<unknown[]>;
  isMemberDirectoryConfigured: () => boolean;
  isInvitationConfigured: () => boolean;
  shutdown: AbortSignal;
};

export const workspaceTeamRoutes: FastifyPluginAsync<WorkspaceTeamRoutesDependencies> = async (app, dependencies) => {
  const { authorizeOwner, memberDirectory } = dependencies;
  app.get("/v1/workspaces/:workspaceId/members", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    if (workspaceId !== authorization.tenantId) return reply.code(403).send({ error: "Select the workspace you want to manage." });
    if (!dependencies.isMemberDirectoryConfigured()) return reply.code(503).send({ error: "Member management is not configured." });
    const members = await dependencies.listWorkspaceMembers(authorization.tenantId);
    const emails = await withReplySignal(reply, dependencies.shutdown, (signal) =>
      memberDirectory.emailsForMembers(members.map((member) => member.userId), signal));
    return { members: members.map((member) => ({ userId: member.userId, email: emails.get(member.userId) ?? null, role: member.role, createdAt: member.createdAt.toISOString() })) };
  });
  app.get('/v1/workspaces/:workspaceId/invitation-deliveries',async(request,reply)=>{
    const owner=await authorizeOwner(request,true);if(!owner.ok)return rejectScope(reply,owner);
    const {workspaceId}=z.strictObject({workspaceId:z.uuid()}).parse(request.params);
    if(workspaceId!==owner.tenantId)return reply.code(403).send({error:'Select the workspace you want to manage.'});
    return {deliveries:await dependencies.listInvitationDeliveries?.(owner.tenantId)??[]};
  });
  app.post("/v1/workspaces/:workspaceId/invitations", {bodyLimit:2048,config:{rateLimit:{max:6}}}, async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    if (workspaceId !== authorization.tenantId) return reply.code(403).send({ error: "Select the workspace you want to manage." });
    if (!dependencies.isInvitationConfigured()) return reply.code(503).send({ error: "Invitations are not configured." });
    const input = invitationSchema.parse(request.body);
    if(!dependencies.inviteWorkspaceMember)return reply.code(503).send({error:'Invitation delivery is unavailable.'});
    const idempotencyKey=z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/).optional().parse(request.headers['idempotency-key']);
    const member=await dependencies.inviteWorkspaceMember.execute({tenantId:authorization.tenantId,actorId:authorization.userId,requestId:request.id,...input,idempotencyKey});
    return reply.code(201).send({member});
  });
  app.patch("/v1/workspaces/:workspaceId/members/:userId", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { workspaceId, userId } = z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }).parse(request.params);
    if (workspaceId !== authorization.tenantId) return reply.code(403).send({ error: "Select the workspace you want to manage." });
    const { role } = memberRoleSchema.parse(request.body);
    const updated = await dependencies.changeWorkspaceMemberRole({ tenantId: authorization.tenantId, userId, role });
    if (!updated) return reply.code(409).send({ error: "Owners cannot have their role changed." });
    return reply.code(204).send();
  });
  app.delete("/v1/workspaces/:workspaceId/members/:userId", async (request, reply) => {
    const authorization = await authorizeOwner(request);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const { workspaceId, userId } = z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }).parse(request.params);
    if (workspaceId !== authorization.tenantId) return reply.code(403).send({ error: "Select the workspace you want to manage." });
    const removed = await dependencies.removeWorkspaceMember({ tenantId: authorization.tenantId, userId });
    if (!removed) return reply.code(409).send({ error: "Owners cannot be removed." });
    return reply.code(204).send();
  });
};
