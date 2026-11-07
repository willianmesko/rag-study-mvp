import type { FastifyPluginAsync } from "fastify";
import { workspaceChatModelPolicySchema } from "@rag-study/contracts";
import type { WorkspaceModelPolicyRepository } from "./application/ports/workspace-model-policy-repository.js";
import type { AuditEventRepository } from "../usage/index.js";
import { chatPromptDescriptors } from "../ai/index.js";
import { modelUnavailable, type ChatModelSelection } from "./http/chat-models.js";
import { rejectScope, type WorkspaceAuthorizer } from "../../platform/http/workspace-authorization.js";

export type ChatModelRoutesDependencies = {
  authorizeMember: WorkspaceAuthorizer;
  authorizeOwner: WorkspaceAuthorizer;
  models: ChatModelSelection;
  workspaceModelPolicies: Pick<WorkspaceModelPolicyRepository, "get" | "save">;
  recordAuditEvent: AuditEventRepository["record"];
};
export const chatModelRoutes: FastifyPluginAsync<ChatModelRoutesDependencies> = async (app, dependencies) => {
  const { authorizeMember, authorizeOwner } = dependencies;
  const { globalChatModels, defaultChatPolicy, workspaceChatModels } = dependencies.models;
  app.get("/v1/admin/chat-model-policy", { exposeHeadRoute: false }, async (request, reply) => {
    const authorization = await authorizeOwner(request, true);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const policy = await dependencies.workspaceModelPolicies.get(authorization.tenantId) ?? defaultChatPolicy;
    return { policy, availableModels: Array.from(globalChatModels.values(), ({ descriptor }) => descriptor) };
  });
  app.patch("/v1/admin/chat-model-policy", { bodyLimit: 4_096 }, async (request, reply) => {
    const authorization = await authorizeOwner(request, true);
    if (!authorization.ok) return rejectScope(reply, authorization);
    const input = workspaceChatModelPolicySchema.parse(request.body);
    if (input.allowedModelIds.some((id) => !globalChatModels.has(id))) return reply.code(400).send(modelUnavailable);
    const policy = await dependencies.workspaceModelPolicies.save(authorization.tenantId, input);
    await dependencies.recordAuditEvent({
      tenantId: authorization.tenantId, actorUserId: authorization.userId, action: "chat.model_policy_updated",
      resourceType: "workspace_model_policy", resourceId: null, requestId: request.id,
      metadata: { allowedModelCount: policy.allowedModelIds.length, autoEnabled: policy.auto !== null }
    });
    return { policy, availableModels: Array.from(globalChatModels.values(), ({ descriptor }) => descriptor) };
  });
  app.get("/v1/qa/models", { exposeHeadRoute: false }, async (request, reply) => {
    const membership = await authorizeMember(request, true);
    if (!membership.ok) return rejectScope(reply, membership);
    const profile = await workspaceChatModels(membership.tenantId);
    const models = Array.from(profile.models.values(), ({ descriptor }) => descriptor);
    if (models.length === 0) return reply.code(503).send(modelUnavailable);
    return { models, comparisonAvailable: models.length >= 2, promptComparisonAvailable: true, promptVariants: chatPromptDescriptors, ...(profile.auto ? { autoAvailable: true } : {}) };
  });
};
