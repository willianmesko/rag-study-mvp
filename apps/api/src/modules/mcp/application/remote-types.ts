import type { McpReadToolName } from "@rag-study/contracts";
import type { TenantRole } from "../../workspaces/index.js";

export const mcpReadScope = "workspace:read";
export type McpPrincipal = {
  tenantId: string; userId: string; role: TenantRole; grantId: string; clientId: string;
  allowedTools: McpReadToolName[]; expiresAt: Date;
};
export type OAuthClient = { id: string; name: string; redirectUris: string[]; expiresAt: Date };
export type OAuthRequest = {
  id: string; clientId: string; redirectUri: string; state: string | null;
  challenge: string; resource: string; expiresAt: Date;
};
export type OAuthGrant = { id: string; tenantId: string; userId: string; clientId: string; allowedTools: McpReadToolName[]; expiresAt: Date; createdAt: Date; clientName: string };
export type OAuthTokenPair = { accessDigest: Buffer; refreshDigest: Buffer; accessExpiresAt: Date; refreshExpiresAt: Date };

export interface McpOAuthRepository {
  register(input: { id: string; name: string; redirectUris: string[] }): Promise<OAuthClient>;
  client(id: string): Promise<OAuthClient | null>;
  request(input: Omit<OAuthRequest, "id" | "expiresAt">): Promise<OAuthRequest>;
  details(id: string): Promise<(OAuthRequest & { clientName: string }) | null>;
  approve(input: { id: string; userId: string; tenantId: string; tools: McpReadToolName[]; codeDigest: Buffer }): Promise<OAuthRequest | null>;
  deny(id: string): Promise<OAuthRequest | null>;
  exchangeCode(input: { digest: Buffer; clientId: string; redirectUri: string; resource: string; verifier: string; tokens: OAuthTokenPair }): Promise<boolean>;
  refresh(input: { digest: Buffer; clientId: string; resource: string; tokens: OAuthTokenPair }): Promise<boolean>;
  verify(digest: Buffer, resource: string): Promise<McpPrincipal | null>;
  revokeToken(digest: Buffer, clientId?: string): Promise<void>;
  grants(userId: string, tenantId: string): Promise<OAuthGrant[]>;
  revokeGrant(userId: string, tenantId: string, grantId: string): Promise<boolean>;
}

export interface McpCallControls {
  admit(tenantId: string, userId: string, signal: AbortSignal): Promise<boolean>;
  begin(input: { principal: McpPrincipal; requestKey: string; tool: McpReadToolName; timeoutMs: number }): Promise<string | null>;
  alive(id: string): Promise<boolean>;
  finish(id: string): Promise<void>;
  cancel(principal: McpPrincipal, requestKey: string): Promise<void>;
}
