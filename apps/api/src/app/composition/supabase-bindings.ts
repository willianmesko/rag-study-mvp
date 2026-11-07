import type { InvitationGateway } from "../../modules/workspaces/application/integrations/workspace-invitations.js";
import { SupabaseInvitationGateway } from "../../modules/workspaces/infrastructure/auth/supabase-invitation-gateway.js";
import type { OriginalFileStore } from "../../modules/knowledge/application/ports/original-file-store.js";
import { SupabaseOriginalFileStore } from "../../modules/knowledge/infrastructure/storage/supabase-original-file-store.js";

export function createSupabaseInvitationGateway(options: {
  url?: string;
  serviceRoleKey?: string;
  appBaseUrl?: string;
}): InvitationGateway {
  return new SupabaseInvitationGateway(options.url, options.serviceRoleKey, options.appBaseUrl);
}

export function createSupabaseOriginalFileStore(options: {
  url?: string;
  serviceRoleKey?: string;
  uploadBucket: string;
}): OriginalFileStore {
  return new SupabaseOriginalFileStore(options.url, options.serviceRoleKey, options.uploadBucket);
}
