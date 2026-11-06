export type TenantRole = "owner" | "editor" | "viewer";

export type TenantMembership = {
  tenantId: string;
  role: TenantRole;
};

export interface TenantMembershipRepository {
  findPrimaryByUserId(userId: string): Promise<TenantMembership | null>;
}
