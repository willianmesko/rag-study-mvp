import { Global, Module, type DynamicModule } from "@nestjs/common";
import { HttpAdapterHost } from '@nestjs/core';
import { CHAT_MODELS_HTTP } from '../../modules/chat/chat-models.controller.js';
import { CHAT_HTTP } from '../../modules/chat/chat.controller.js';
import { CONVERSATIONS_HTTP } from "../../modules/chat/conversations.controller.js";
import { ChatHttpModule } from '../../modules/chat/http/chat-http.module.js';
import { EVALUATIONS_HTTP } from '../../modules/evaluations/evaluations.controller.js';
import { EvaluationsHttpModule } from '../../modules/evaluations/http/evaluations-http.module.js';
import { IngestionHttpModule } from '../../modules/ingestion/http/ingestion-http.module.js';
import { INGESTION_HTTP } from '../../modules/ingestion/ingestion.controller.js';
import { DOCUMENTS_HTTP } from '../../modules/knowledge/documents.controller.js';
import { KnowledgeHttpModule } from '../../modules/knowledge/http/knowledge-http.module.js';
import { SEARCH_HTTP } from '../../modules/knowledge/search.controller.js';
import { AGENT_ACTIONS_HTTP } from "../../modules/mcp/agent-actions.controller.js";
import { McpHttpModule } from "../../modules/mcp/http/mcp-http.module.js";
import { REMOTE_MCP_HTTP } from "../../modules/mcp/infrastructure/remote.js";
import { MCP_OAUTH_HTTP } from "../../modules/mcp/mcp-oauth.controller.js";
import { WORKSPACE_MCP_HTTP } from "../../modules/mcp/workspace-mcp.controller.js";
import { UsageHttpModule } from '../../modules/usage/http/usage-http.module.js';
import { OPERATIONS_HTTP } from '../../modules/usage/operations.controller.js';
import { WorkspacesHttpModule } from '../../modules/workspaces/http/workspaces-http.module.js';
import { WORKSPACE_TEAM_HTTP } from '../../modules/workspaces/workspace-team.controller.js';
import { WORKSPACES_HTTP } from '../../modules/workspaces/workspaces.controller.js';
import { HttpReplyInterceptor } from "../../platform/http/nest-http-reply.interceptor.js";
import { HTTP_AUTHORIZATION, HTTP_TRANSPORT_LOGGER } from "../../platform/http/nest-workspace.guard.js";
import type { createApplication } from "../app.module.js";
import type { AiRuntime } from '../composition/ai-runtime.js';
import { assembleApplicationRuntime } from '../composition/application-runtime.js';
import type { ChatRuntime } from '../composition/chat-runtime.js';
import type { CoreRuntime } from '../composition/core-runtime.js';
import type { EvaluationsRuntime } from '../composition/evaluations-runtime.js';
import type { IngestionRuntime } from '../composition/ingestion-runtime.js';
import type { KnowledgeRuntime } from '../composition/knowledge-runtime.js';
import type { McpRuntime } from '../composition/mcp-runtime.js';
import type { UsageRuntime } from '../composition/usage-runtime.js';
import type { WorkflowsRuntime } from '../composition/workflows-runtime.js';
import type { WorkspacesRuntime } from '../composition/workspaces-runtime.js';
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { HttpDependencies } from "../http-dependencies.js";
import type { HttpFeatureBindings } from '../http-feature-bindings.js';
import { HealthController } from "./health.controller.js";
import { configureHttpContext, HTTP_FEATURE_BINDINGS } from './http-context.provider.js';
import { AiRuntimeModule } from './modules/ai-runtime.module.js';
import { ChatRuntimeModule } from './modules/chat-runtime.module.js';
import { CoreRuntimeModule } from './modules/core-runtime.module.js';
import { EvaluationsRuntimeModule } from './modules/evaluations-runtime.module.js';
import { IngestionRuntimeModule } from './modules/ingestion-runtime.module.js';
import { KnowledgeRuntimeModule } from './modules/knowledge-runtime.module.js';
import { McpRuntimeModule } from './modules/mcp-runtime.module.js';
import { UsageRuntimeModule } from './modules/usage-runtime.module.js';
import { WorkflowsRuntimeModule } from './modules/workflows-runtime.module.js';
import { WorkspacesRuntimeModule } from './modules/workspaces-runtime.module.js';
import { AI_RUNTIME, CHAT_RUNTIME, CORE_RUNTIME, EVALUATIONS_RUNTIME, INGESTION_RUNTIME, KNOWLEDGE_RUNTIME, MCP_RUNTIME, USAGE_RUNTIME, WORKFLOWS_RUNTIME, WORKSPACES_RUNTIME } from './runtime.tokens.js';
import { APPLICATION_RUNTIME, HTTP_DEPENDENCIES, RUNTIME_CONFIGURATION } from "./tokens.js";
@Global()
@Module({})
export class NestApplicationModule {
    static register(configuration: RuntimeConfiguration, dependencies?: HttpDependencies, isProduction?: boolean): DynamicModule {
        return {
            module: NestApplicationModule,
            imports: [WorkspacesHttpModule, KnowledgeHttpModule, IngestionHttpModule, UsageHttpModule, EvaluationsHttpModule, ChatHttpModule.register(dependencies ? Boolean(dependencies.conversations) : true),
                McpHttpModule.register({ workspace: dependencies ? Boolean(dependencies.workspaceMcp) : configuration.MCP_ENABLED,
                    remote: dependencies ? Boolean(dependencies.remoteMcp) : configuration.MCP_REMOTE_ENABLED,
                    actions: dependencies ? Boolean(dependencies.agentActions) : configuration.AGENT_ACTIONS_ENABLED }), ...(dependencies ? [] : [CoreRuntimeModule.register(configuration), UsageRuntimeModule, WorkspacesRuntimeModule, AiRuntimeModule, KnowledgeRuntimeModule, ChatRuntimeModule, EvaluationsRuntimeModule, WorkflowsRuntimeModule, IngestionRuntimeModule, McpRuntimeModule])],
            controllers: [HealthController],
            exports: [HttpReplyInterceptor, RUNTIME_CONFIGURATION, HTTP_TRANSPORT_LOGGER, CONVERSATIONS_HTTP, WORKSPACE_MCP_HTTP, AGENT_ACTIONS_HTTP, MCP_OAUTH_HTTP, REMOTE_MCP_HTTP, HTTP_AUTHORIZATION, WORKSPACES_HTTP, WORKSPACE_TEAM_HTTP, DOCUMENTS_HTTP, INGESTION_HTTP, OPERATIONS_HTTP, EVALUATIONS_HTTP, SEARCH_HTTP, CHAT_MODELS_HTTP, CHAT_HTTP],
            providers: [
                HttpReplyInterceptor,
                { provide: HTTP_TRANSPORT_LOGGER, useFactory: (host: HttpAdapterHost) => ({ log: host.httpAdapter.getInstance().log }), inject: [HttpAdapterHost] },
                { provide: CONVERSATIONS_HTTP, useFactory: (context: HttpFeatureBindings) => context.conversations, inject: [HTTP_FEATURE_BINDINGS] },
                { provide: WORKSPACE_MCP_HTTP, useFactory: (context: HttpFeatureBindings) => context.workspaceMcp, inject: [HTTP_FEATURE_BINDINGS] },
                { provide: AGENT_ACTIONS_HTTP, useFactory: (context: HttpFeatureBindings) => context.agentActions, inject: [HTTP_FEATURE_BINDINGS] },
                { provide: MCP_OAUTH_HTTP, useFactory: (context: HttpFeatureBindings) => context.mcpOAuth, inject: [HTTP_FEATURE_BINDINGS] },
                { provide: REMOTE_MCP_HTTP, useFactory: (context: HttpFeatureBindings) => context.remoteMcp, inject: [HTTP_FEATURE_BINDINGS] },
                { provide: RUNTIME_CONFIGURATION, useValue: configuration },
                { provide: HTTP_FEATURE_BINDINGS, useFactory: (host: HttpAdapterHost, http: HttpDependencies) => configureHttpContext(host.httpAdapter.getInstance(), http, configuration, isProduction), inject: [HttpAdapterHost, HTTP_DEPENDENCIES] },
                { provide: HTTP_AUTHORIZATION, useFactory: (context: HttpFeatureBindings) => ({ user: context.workspaces.authorizeUser, member: context.workspaces.authorizeMember, admin: context.documents.authorizeAdmin, owner: context.team.authorizeOwner }), inject: [HTTP_FEATURE_BINDINGS] },
                { provide: WORKSPACES_HTTP, useFactory: (context: HttpFeatureBindings) => context.workspaces, inject: [HTTP_FEATURE_BINDINGS] },
                { provide: WORKSPACE_TEAM_HTTP, useFactory: (context: HttpFeatureBindings) => context.team, inject: [HTTP_FEATURE_BINDINGS] },
                { provide: DOCUMENTS_HTTP, useFactory: (context: HttpFeatureBindings) => context.documents, inject: [HTTP_FEATURE_BINDINGS] },
                { provide: INGESTION_HTTP, useFactory: (context: HttpFeatureBindings) => context.ingestion, inject: [HTTP_FEATURE_BINDINGS] },
                { provide: OPERATIONS_HTTP, useFactory: (context: HttpFeatureBindings) => context.operations, inject: [HTTP_FEATURE_BINDINGS] },
                { provide: EVALUATIONS_HTTP, useFactory: (context: HttpFeatureBindings) => context.evaluations, inject: [HTTP_FEATURE_BINDINGS] },
                { provide: SEARCH_HTTP, useFactory: (context: HttpFeatureBindings) => context.search, inject: [HTTP_FEATURE_BINDINGS] },
                { provide: CHAT_MODELS_HTTP, useFactory: (context: HttpFeatureBindings) => context.models, inject: [HTTP_FEATURE_BINDINGS] },
                { provide: CHAT_HTTP, useFactory: (context: HttpFeatureBindings) => context.chat, inject: [HTTP_FEATURE_BINDINGS] },
                ...(dependencies ? [{ provide: HTTP_DEPENDENCIES, useValue: dependencies }] : [
                    { provide: APPLICATION_RUNTIME, useFactory: (config: RuntimeConfiguration, core: CoreRuntime, usage: UsageRuntime, workspaces: WorkspacesRuntime, ai: AiRuntime, knowledge: KnowledgeRuntime, chat: ChatRuntime, evaluations: EvaluationsRuntime, workflows: WorkflowsRuntime, ingestion: IngestionRuntime, mcp: McpRuntime) => {
                            const application = assembleApplicationRuntime(config, core, usage, workspaces, ai, knowledge, chat, evaluations, workflows, ingestion, mcp);
                            return Object.assign(application, { onModuleDestroy: () => application.close() });
                        }, inject: [RUNTIME_CONFIGURATION, CORE_RUNTIME, USAGE_RUNTIME, WORKSPACES_RUNTIME, AI_RUNTIME, KNOWLEDGE_RUNTIME, CHAT_RUNTIME, EVALUATIONS_RUNTIME, WORKFLOWS_RUNTIME, INGESTION_RUNTIME, MCP_RUNTIME] },
                    { provide: HTTP_DEPENDENCIES, useFactory: (application: ReturnType<typeof createApplication>) => application.useCases, inject: [APPLICATION_RUNTIME] },
                ]),
            ],
        };
    }
}
