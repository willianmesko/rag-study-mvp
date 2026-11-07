import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { workspaceOnboardingProgressSchema } from "@rag-study/contracts";
import type { TenantMembershipRepository } from "./application/ports/tenant-membership-repository.js";
import type { WorkspaceOnboardingRepository } from "./application/ports/workspace-onboarding-repository.js";
import { rejectScope, type UserAuthorizer, type WorkspaceAuthorizer } from "../../platform/http/workspace-authorization.js";
import { isWorkspaceSlugConflict } from "../../platform/http/request-errors.js";

const workspaceIdSchema = z.string().uuid();
export type WorkspaceRoutesDependencies = {
  authorizeUser: UserAuthorizer;
  authorizeMember: WorkspaceAuthorizer;
  listMemberships: TenantMembershipRepository["listByUserId"];
  createWorkspace: TenantMembershipRepository["createWorkspace"];
  workspaceOnboarding: Pick<WorkspaceOnboardingRepository, "get" | "save">;
};

export const workspaceRoutes: FastifyPluginAsync<WorkspaceRoutesDependencies> = async (app, dependencies) => {
  const { authorizeMember } = dependencies;
  app.get("/v1/workspaces", async (request, reply) => {
    const identity = await dependencies.authorizeUser(request);
    if (!identity.ok) return rejectScope(reply, identity);
    return { workspaces: await dependencies.listMemberships(identity.userId) };
  });
  app.post("/v1/workspaces", async (request, reply) => {
    const identity = await dependencies.authorizeUser(request);
    if (!identity.ok) return rejectScope(reply, identity);
    const input=z.object({name:z.string().trim().min(2).max(100),slug:z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,60}$/)}).parse(request.body);
    try {
      return reply.code(201).send({ workspace: await dependencies.createWorkspace({ userId: identity.userId, ...input }) });
    } catch (error) {
      if (isWorkspaceSlugConflict(error)) return reply.code(409).send({ error: "Workspace name or slug already exists." });
      throw error;
    }
  });
  app.route({
    method: ["GET", "PATCH"],
    url: "/v1/workspaces/:workspaceId/onboarding",
    exposeHeadRoute: false,
    bodyLimit: 2_048,
    async handler(request, reply) {
      const authorization = await authorizeMember(request, true);
      if (!authorization.ok) return rejectScope(reply, authorization);
      const { workspaceId } = z.object({ workspaceId: workspaceIdSchema }).parse(request.params);
      const { tenantId, userId } = authorization;
      if (workspaceId !== tenantId) return reply.code(403).send({ error: "Select the workspace you want to open." });

      const scope = { tenantId, userId };
      const progress = request.method === "PATCH"
        ? await dependencies.workspaceOnboarding.save(scope, workspaceOnboardingProgressSchema.parse(request.body))
        : await dependencies.workspaceOnboarding.get(scope);
      return { progress };
    }
  });
};
