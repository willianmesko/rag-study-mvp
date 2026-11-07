import type { IncomingMessage } from "node:http";
import type { IdentityVerifier, IdentityVerification } from "../application/ports/identity-verifier.js";

export type IdentityRequest = {
  headers: Record<string, string | string[] | undefined>;
  raw?: IncomingMessage;
};

/** Share verification only inside one request; fresh requests revalidate sessions. */
export class RequestIdentity {
  private readonly principals = new WeakMap<IdentityRequest, Promise<IdentityVerification>>();

  constructor(private readonly verifier: IdentityVerifier) {}

  verify(request: IdentityRequest): Promise<IdentityVerification> {
    const existing = this.principals.get(request);
    if (existing) return existing;
    const principal = this.resolve(request);
    this.principals.set(request, principal);
    return principal;
  }

  private async resolve(request: IdentityRequest): Promise<IdentityVerification> {
    const authorization = request.headers.authorization;
    const token = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token.trim()) return { ok: false, reason: "missing_session" };
    const cancel = new AbortController();
    const disconnect = () => cancel.abort();
    if (request.raw?.aborted || request.raw?.socket?.destroyed) disconnect();
    request.raw?.once("aborted", disconnect);
    request.raw?.socket?.once("close", disconnect);
    try { return await this.verifier.verify(token, cancel.signal); }
    catch { return { ok: false, reason: "unavailable" }; }
    finally {
      request.raw?.off("aborted", disconnect);
      request.raw?.socket?.off("close", disconnect);
    }
  }
}
