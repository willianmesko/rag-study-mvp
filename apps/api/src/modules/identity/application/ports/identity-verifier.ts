export type IdentityFailureReason =
  | "missing_session"
  | "invalid_session"
  | "not_configured"
  | "unavailable"
  | "timeout"
  | "cancelled";

export type IdentityVerification =
  | { ok: true; userId: string }
  | { ok: false; reason: IdentityFailureReason };

/** Verify with the authoritative identity service; do not trust editable claims. */
export interface IdentityVerifier {
  verify(token: string, signal?: AbortSignal): Promise<IdentityVerification>;
}

export type MemberDirectoryFailureReason = "not_configured" | "unavailable" | "timeout" | "cancelled";

export class MemberDirectoryError extends Error {
  constructor(readonly reason: MemberDirectoryFailureReason) {
    super("Workspace member identities are unavailable.");
    this.name = "MemberDirectoryError";
  }
}

/** IDs must come from an authorized workspace membership query, never the browser. */
export interface MemberDirectory {
  emailsForMembers(userIds: readonly string[], signal?: AbortSignal): Promise<ReadonlyMap<string, string | null>>;
}
