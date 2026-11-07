import { createHash, randomBytes } from "node:crypto";
import type { TenantRole } from "../../workspaces/index.js";

type Membership = { tenantId: string; userId: string };
export type McpAdmission = Membership & { role: TenantRole; allowed: boolean };

export interface McpAccessRepository {
  save(input: Membership & { digest: Buffer }): Promise<Date>;
  expiresAt(input: Membership): Promise<Date | null>;
  revoke(input: Membership): Promise<void>;
  admit(input: { tenantId: string; digest: Buffer }): Promise<McpAdmission | null>;
  validate(input: { tenantId: string; digest: Buffer }): Promise<McpAdmission | null>;
}

export class McpAccess {
  constructor(private readonly repository: McpAccessRepository) {}

  async issue(scope: Membership) {
    const token = `lumora_mcp_${randomBytes(32).toString("base64url")}`;
    const expiresAt = await this.repository.save({ ...scope, digest: tokenDigest(token) });
    return { token, workspaceId: scope.tenantId, expiresAt: expiresAt.toISOString() };
  }

  async status(scope: Membership) {
    const expiresAt = await this.repository.expiresAt(scope);
    return { expiresAt: expiresAt?.toISOString() ?? null };
  }

  revoke(scope: Membership) { return this.repository.revoke(scope); }

  admit(tenantId: string, token: string) {
    return this.repository.admit({ tenantId, digest: tokenDigest(token) });
  }
  validate(tenantId: string, token: string) { return this.repository.validate({ tenantId, digest: tokenDigest(token) }); }
}

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}
