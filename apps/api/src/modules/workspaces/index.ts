// Deliberate public contracts and capabilities; concrete composition stays in the module factory.
export { type TenantMembership, type TenantMembershipRepository, type TenantRole } from "./application/ports/tenant-membership-repository.js";
export { type InvitationDeliveryHistory, type InvitationDeliveryRecord } from "./application/ports/invitation-delivery-history.js";
