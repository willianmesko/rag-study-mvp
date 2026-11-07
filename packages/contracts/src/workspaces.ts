import { z } from "zod";

export const workspaceRoleSchema = z.enum(["owner", "editor", "viewer"]);
export const workspaceSchema = z.object({
  tenantId: z.uuid(),
  tenantName: z.string().min(1).max(100),
  tenantSlug: z.string().min(1).max(100),
  role: workspaceRoleSchema,
});
export const workspacesResponseSchema = z.object({ workspaces: z.array(workspaceSchema) });
export const workspaceCreatedResponseSchema = z.object({ workspace: workspaceSchema });

export const workspaceMemberSchema = z.object({
  userId: z.uuid(),
  email: z.email().max(320).nullable(),
  role: workspaceRoleSchema,
  createdAt: z.iso.datetime(),
});
export const workspaceMembersResponseSchema = z.object({ members: z.array(workspaceMemberSchema) });
export const workspaceInvitationResponseSchema = z.object({
  member: workspaceMemberSchema.omit({ createdAt: true }),
});

export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
