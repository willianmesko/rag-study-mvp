import type { IdentityVerifier, MemberDirectory } from "./application/ports/identity-verifier.js";
import { SupabaseIdentityGateway } from "./infrastructure/auth/supabase-identity-gateway.js";

export type IdentityServices = { identityVerifier: IdentityVerifier; memberDirectory: MemberDirectory };

/** One stateless gateway owns the separate public and administrative clients. */
export function createIdentityServices(options: {
  url?: string;
  publishableKey?: string;
  serviceRoleKey?: string;
  timeoutMs: number;
}): IdentityServices {
  const gateway = new SupabaseIdentityGateway(options);
  return { identityVerifier: gateway, memberDirectory: gateway };
}
