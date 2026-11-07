import type { Pool } from "pg";
import { InviteWorkspaceMember } from "./application/integrations/workspace-invitations.js";
import { SupabaseInvitationGateway } from "./infrastructure/auth/supabase-invitation-gateway.js";
import { PgInvitationDeliveries } from "./infrastructure/postgres/pg-invitation-deliveries.js";
import { PgTenantMembershipRepository } from "./infrastructure/postgres/pg-tenant-membership-repository.js";
import { PgWorkspaceOnboardingRepository } from "./infrastructure/postgres/pg-workspace-onboarding-repository.js";

/** Assemble workspace providers using the application-owned pool. */
export function createWorkspacesServices(pool: Pool, options: {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  appBaseUrl?: string;
}) {
  const invitationDeliveries = new PgInvitationDeliveries(pool);
  return {
    memberships: new PgTenantMembershipRepository(pool),
    workspaceOnboarding: new PgWorkspaceOnboardingRepository(pool),
    invitationDeliveries,
    inviteWorkspaceMember: new InviteWorkspaceMember(
      invitationDeliveries,
      new SupabaseInvitationGateway(options.supabaseUrl, options.serviceRoleKey, options.appBaseUrl),
    ),
  };
}
