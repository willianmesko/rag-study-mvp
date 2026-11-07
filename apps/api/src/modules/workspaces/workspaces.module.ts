import {
  InviteWorkspaceMember,
  type InvitationDeliveryRepository,
  type InvitationGateway,
} from "./application/integrations/workspace-invitations.js";
import type { InvitationDeliveryHistory } from "./application/ports/invitation-delivery-history.js";
import type { TenantMembershipRepository } from "./application/ports/tenant-membership-repository.js";
import type { WorkspaceOnboardingRepository } from "./application/ports/workspace-onboarding-repository.js";

/** Invitation policy depends on capabilities; application composition selects adapters. */
export function createWorkspacesServices(dependencies: {
  memberships: TenantMembershipRepository;
  workspaceOnboarding: WorkspaceOnboardingRepository;
  invitationDeliveries: InvitationDeliveryRepository & InvitationDeliveryHistory;
  invitationGateway: InvitationGateway;
}) {
  const { memberships, workspaceOnboarding, invitationDeliveries, invitationGateway } = dependencies;
  return {
    memberships,
    workspaceOnboarding,
    invitationDeliveries,
    inviteWorkspaceMember: new InviteWorkspaceMember(invitationDeliveries, invitationGateway),
  };
}
