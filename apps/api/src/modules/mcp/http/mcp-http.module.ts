import { Module } from "@nestjs/common";
import { AgentActionsController } from "../agent-actions.controller.js";
import { McpOAuthController } from "../mcp-oauth.controller.js";
import { RemoteMcpController } from "../remote.controller.js";
import { WorkspaceMcpController } from "../workspace-mcp.controller.js";
import { ApprovedActionOwnerGuard, McpConsentGuard, McpManagementGuard, McpToolInputGuard, RemoteMcpSessionGuard } from "./mcp-http.guards.js";
@Module({})
export class McpHttpModule {
    static register(options: {
        workspace: boolean;
        remote: boolean;
        actions: boolean;
    }) {
        return { module: McpHttpModule, providers: [ApprovedActionOwnerGuard, McpManagementGuard, McpToolInputGuard, McpConsentGuard, RemoteMcpSessionGuard], controllers: [
                ...(options.workspace ? [WorkspaceMcpController] : []),
                ...(options.remote ? [McpOAuthController, RemoteMcpController] : []),
                ...(options.actions ? [AgentActionsController] : [])
            ] };
    }
}
