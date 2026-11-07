export type TenantRole = "owner" | "editor" | "viewer";

export type TenantMembership = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: TenantRole;
};

export type WorkspaceMember = {
  userId: string;
  role: TenantRole;
  createdAt: Date;
};

export interface TenantMembershipRepository {
  listByUserId(userId: string, limit?: number): Promise<TenantMembership[]>;
  findByUserAndTenant(userId: string, tenantId: string): Promise<TenantMembership | null>;
  createWorkspace(input: { userId: string; name: string; slug: string }): Promise<TenantMembership>;
  listMembers(tenantId: string): Promise<WorkspaceMember[]>;
  addMember(input: { tenantId: string; userId: string; role: Exclude<TenantRole, "owner"> }): Promise<void>;
  changeMemberRole(input: { tenantId: string; userId: string; role: Exclude<TenantRole, "owner"> }): Promise<boolean>;
  removeMember(input: { tenantId: string; userId: string }): Promise<boolean>;
  recordInvitation(input: { tenantId: string; email: string; role: Exclude<TenantRole, "owner">; invitedBy: string; invitedUserId: string }): Promise<void>;
}
