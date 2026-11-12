import { Module } from '@nestjs/common';
import type { AiRuntime } from '../../composition/ai-runtime.js';
import type { CoreRuntime } from '../../composition/core-runtime.js';
import { createMcpRuntime } from '../../composition/mcp-runtime.js';
import type { RuntimeConfiguration } from '../../configuration/environment.js';
import { AI_RUNTIME, CORE_RUNTIME, MCP_RUNTIME } from '../runtime.tokens.js';
import { RUNTIME_CONFIGURATION } from '../tokens.js';
import { AiRuntimeModule } from './ai-runtime.module.js';
@Module({ imports: [AiRuntimeModule], providers: [{ provide: MCP_RUNTIME, useFactory: (config: RuntimeConfiguration, core: CoreRuntime, ai: AiRuntime) => createMcpRuntime(config, core, ai), inject: [RUNTIME_CONFIGURATION, CORE_RUNTIME, AI_RUNTIME] }], exports: [MCP_RUNTIME] })
export class McpRuntimeModule {
}
