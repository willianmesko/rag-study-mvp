import type { EmbeddingModelIdentity, EmbeddingProvider } from "../ai/index.js";
import { McpAccess, type McpAccessRepository } from "./application/access.js";
import { McpReadTools, type McpReadRepository } from "./application/read-tools.js";
import { McpHybridSearch, type McpHybridReadRepository, type McpProviderBudget } from "./application/hybrid-search.js";
import { McpOAuth } from "./application/oauth.js";
import type { McpCallControls, McpOAuthRepository } from "./application/remote-types.js";
import { AgentActionService, type AgentActionRepository } from "./application/agent-actions/agent-action-service.js";

export type McpServiceDependencies = {
  access: McpAccessRepository;
  reads: (McpReadRepository & McpHybridReadRepository) | null;
  oauth: McpOAuthRepository;
  actions: AgentActionRepository;
  controls: McpCallControls & McpProviderBudget;
  measuredEmbeddings: (identity: EmbeddingModelIdentity, tenantId?: string) => EmbeddingProvider;
  defaultEmbeddingIdentity: () => EmbeddingModelIdentity;
  options: {
    remote?: { resource: string; appUrl: string };
    agentActionsEnabled: boolean;
    embeddingInputCostPer1kUsd: number;
    maxCostNanoUsd: number;
  };
};

export function createMcpServices(dependencies: McpServiceDependencies) {
  const { access, reads, oauth, actions, controls, measuredEmbeddings, defaultEmbeddingIdentity, options } = dependencies;
  const mcpTools = reads
    ? new McpReadTools(
        reads,
        new McpHybridSearch(
          reads,
          controls,
          measuredEmbeddings,
          [
            {
              ...defaultEmbeddingIdentity(),
              inputCostPer1kUsd: options.embeddingInputCostPer1kUsd,
            },
          ],
          {
            maxInputTokens: 2048,
            maxCostNanoUsd: options.maxCostNanoUsd,
          },
        ),
      )
    : null;
  return {
    workspaceMcp: mcpTools ? { access: new McpAccess(access), tools: mcpTools, controls } : undefined,
    remoteMcp: options.remote && mcpTools
      ? { oauth: new McpOAuth(oauth, options.remote.resource, options.remote.appUrl), tools: mcpTools, controls }
      : undefined,
    agentActions: options.agentActionsEnabled ? new AgentActionService(actions) : undefined,
  };
}
