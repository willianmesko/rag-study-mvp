import type { Pool } from "pg";
import type { config } from "../../config.js";
import type { EmbeddingModelIdentity, EmbeddingProvider } from "../ai/index.js";
import { McpAccess } from "./application/access.js";
import { McpReadTools } from "./application/read-tools.js";
import { McpHybridSearch } from "./application/hybrid-search.js";
import { McpOAuth } from "./application/oauth.js";
import { AgentActionService } from "./application/agent-actions/agent-action-service.js";
import { PgMcpControls } from "./infrastructure/postgres/pg-mcp-controls.js";
import { PgMcpReadRepository } from "./infrastructure/postgres/pg-mcp-read-repository.js";
import { PgMcpAccessRepository } from "./infrastructure/postgres/pg-mcp-access-repository.js";
import { PgMcpOAuthRepository } from "./infrastructure/postgres/pg-mcp-oauth-repository.js";
import { PgAgentActionRepository } from "./infrastructure/postgres/pg-agent-action-repository.js";

type McpConfiguration = Pick<typeof config,
  "MCP_CALLS_PER_MINUTE" | "MCP_CALLS_PER_DAY" | "MCP_PROVIDER_CALLS_PER_DAY" | "MCP_INPUT_TOKENS_PER_DAY" |
  "MCP_USER_COST_USD_PER_DAY" | "MCP_WORKSPACE_COST_USD_PER_DAY" | "MCP_CONCURRENT_PROVIDERS" |
  "EMBEDDING_INPUT_COST_PER_1K_USD" | "MCP_COST_USD_PER_CALL" | "MCP_REMOTE_ENABLED" | "MCP_PUBLIC_URL" | "APP_BASE_URL" | "AGENT_ACTIONS_ENABLED">;

export function createMcpServices(dependencies: {
  pool: Pool;
  readPool: Pool | null;
  measuredEmbeddings: (identity: EmbeddingModelIdentity, tenantId?: string) => EmbeddingProvider;
  defaultEmbeddingIdentity: () => EmbeddingModelIdentity;
  configuration: McpConfiguration;
}) {
  const { pool, readPool: mcpReadPool, measuredEmbeddings, defaultEmbeddingIdentity, configuration } = dependencies;
  const mcpControls = new PgMcpControls(pool, {
    callsPerMinute: configuration.MCP_CALLS_PER_MINUTE,
    callsPerDay: configuration.MCP_CALLS_PER_DAY,
    providerCallsPerDay: configuration.MCP_PROVIDER_CALLS_PER_DAY,
    inputTokensPerDay: configuration.MCP_INPUT_TOKENS_PER_DAY,
    userCostNanoUsdPerDay: Math.floor(configuration.MCP_USER_COST_USD_PER_DAY * 1e9),
    tenantCostNanoUsdPerDay: Math.floor(
      configuration.MCP_WORKSPACE_COST_USD_PER_DAY * 1e9,
    ),
    concurrentProviders: configuration.MCP_CONCURRENT_PROVIDERS,
  });
  const mcpReads = mcpReadPool ? new PgMcpReadRepository(mcpReadPool) : null;
  const mcpTools = mcpReads
    ? new McpReadTools(
        mcpReads,
        new McpHybridSearch(
          mcpReads,
          mcpControls,
          measuredEmbeddings,
          [
            {
              ...defaultEmbeddingIdentity(),
              inputCostPer1kUsd: configuration.EMBEDDING_INPUT_COST_PER_1K_USD,
            },
          ],
          {
            maxInputTokens: 2048,
            maxCostNanoUsd: Math.floor(configuration.MCP_COST_USD_PER_CALL * 1e9),
          },
        ),
      )
    : null;
  return {
    workspaceMcp: mcpTools ? { access: new McpAccess(new PgMcpAccessRepository(pool)), tools: mcpTools, controls: mcpControls } : undefined,
    remoteMcp: configuration.MCP_REMOTE_ENABLED && mcpTools
      ? { oauth: new McpOAuth(new PgMcpOAuthRepository(pool), configuration.MCP_PUBLIC_URL!, configuration.APP_BASE_URL!), tools: mcpTools, controls: mcpControls }
      : undefined,
    agentActions: configuration.AGENT_ACTIONS_ENABLED ? new AgentActionService(new PgAgentActionRepository(pool)) : undefined,
  };
}
