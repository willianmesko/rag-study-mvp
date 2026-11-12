import { createWorkspacesServices } from "../../modules/workspaces/workspaces.module.js";
import type { RuntimeConfiguration } from "../configuration/environment.js";
import type { CoreRuntime } from './core-runtime.js';
import { createPostgresWorkspaceBindings } from "./postgres-persistence.js";
import { createSupabaseInvitationGateway } from "./supabase-bindings.js";
export function createWorkspacesRuntime(config: RuntimeConfiguration, core: CoreRuntime) {
    const { pool } = core;
    const { memberships, workspaceOnboarding, invitationDeliveries, inviteWorkspaceMember } = createWorkspacesServices({
        ...createPostgresWorkspaceBindings(pool),
        invitationGateway: createSupabaseInvitationGateway({
            url: config.SUPABASE_URL,
            serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
            appBaseUrl: config.APP_BASE_URL,
        }),
    });
    return { memberships, workspaceOnboarding, invitationDeliveries, inviteWorkspaceMember };
}
export type WorkspacesRuntime = ReturnType<typeof createWorkspacesRuntime>;
