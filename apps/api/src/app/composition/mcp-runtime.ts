import { createMcpServices } from "../../modules/mcp/mcp.module.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { AiRuntime } from './ai-runtime.js';
import type { CoreRuntime } from './core-runtime.js';
import { createPostgresMcpBindings } from "./postgres-persistence.js";
export function createMcpRuntime(config: RuntimeConfiguration, core: CoreRuntime, ai: AiRuntime) {
    const { pool, mcpReadPool, providerBindings } = core;
    const { measuredEmbeddings } = ai;
    const mcpServices = createMcpServices({
        ...createPostgresMcpBindings(pool, mcpReadPool, {
            callsPerMinute: config.MCP_CALLS_PER_MINUTE,
            callsPerDay: config.MCP_CALLS_PER_DAY,
            providerCallsPerDay: config.MCP_PROVIDER_CALLS_PER_DAY,
            inputTokensPerDay: config.MCP_INPUT_TOKENS_PER_DAY,
            userCostNanoUsdPerDay: Math.floor(config.MCP_USER_COST_USD_PER_DAY * 1e9),
            tenantCostNanoUsdPerDay: Math.floor(config.MCP_WORKSPACE_COST_USD_PER_DAY * 1e9),
            concurrentProviders: config.MCP_CONCURRENT_PROVIDERS,
        }),
        measuredEmbeddings,
        defaultEmbeddingIdentity: () => providerBindings.defaultEmbedding,
        options: {
            remote: config.MCP_REMOTE_ENABLED ? { resource: config.MCP_PUBLIC_URL!, appUrl: config.APP_BASE_URL! } : undefined,
            agentActionsEnabled: config.AGENT_ACTIONS_ENABLED,
            embeddingInputCostPer1kUsd: config.EMBEDDING_INPUT_COST_PER_1K_USD,
            maxCostNanoUsd: Math.floor(config.MCP_COST_USD_PER_CALL * 1e9),
        },
    });
    return { mcpServices };
}
export type McpRuntime = ReturnType<typeof createMcpRuntime>;
