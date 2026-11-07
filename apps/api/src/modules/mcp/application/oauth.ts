import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { mcpReadToolNames, type McpReadToolName } from "@rag-study/contracts";
import type { McpOAuthRepository, OAuthTokenPair } from "./remote-types.js";
import { mcpReadScope } from "./remote-types.js";

export const mcpOAuthAccessPattern = /^lumora_mcp_at_[A-Za-z0-9_-]{43}$/;
const refreshPattern = /^lumora_mcp_rt_[A-Za-z0-9_-]{43}$/;
const codePattern = /^lumora_mcp_code_[A-Za-z0-9_-]{43}$/;
const clientPattern = /^lumora_client_[A-Za-z0-9_-]{43}$/;
const cleanString = (max: number) => z.string().max(max).refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value));
const verifierSchema = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);
const challengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export class OAuthRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); this.name = "OAuthRequestError"; }
}
export function digestMcpSecret(value: string): Buffer { return createHash("sha256").update(value).digest(); }
function opaque(prefix: string) { return prefix + randomBytes(32).toString("base64url"); }

export function safeRedirectUri(value: string): boolean {
  try {
    if (value.length > 2048 || /[\s\\\p{Cc}\p{Cf}]/u.test(value)) return false;
    const url = new URL(value);
    if (url.username || url.password || url.hash || url.href !== value) return false;
    if (["code","state","error","iss","access_token","refresh_token"].some((key) => url.searchParams.has(key))) return false;
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.protocol === "http:") return loopback;
    return url.protocol === "https:" && !loopback && !isIP(url.hostname.replace(/^\[|\]$/g, ""))
      && !/\.(?:localhost|local|internal|home\.arpa|onion)\.?$/i.test(url.hostname) && url.hostname.includes(".");
  } catch { return false; }
}

const clientMetadata = z.strictObject({
  client_name: cleanString(80).trim().min(1).default("MCP client"),
  redirect_uris: z.array(z.string().refine(safeRedirectUri)).min(1).max(5).refine((items) => new Set(items).size === items.length),
  token_endpoint_auth_method: z.literal("none").default("none"),
  application_type: z.enum(["web", "native"]).optional(),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).min(1).max(2).default(["authorization_code", "refresh_token"]),
  response_types: z.array(z.literal("code")).length(1).default(["code"]),
  scope: z.literal(mcpReadScope).optional(),
  client_uri: z.url().max(2048).optional(), logo_uri: z.url().max(2048).optional(),
  tos_uri: z.url().max(2048).optional(), policy_uri: z.url().max(2048).optional(),
  software_id: cleanString(128).optional(), software_version: cleanString(80).optional(),
  contacts: z.array(z.string().email().max(320)).max(3).optional()
});
// OAuth requires unknown extension parameters to be ignored, not rejected.
// Known security fields still have exact schemas; duplicates are rejected by
// the form/query parser before reaching this boundary.
const authorizeInput = z.object({
  response_type: z.literal("code"), client_id: z.string().regex(clientPattern),
  redirect_uri: z.string().max(2048), code_challenge: challengeSchema, code_challenge_method: z.literal("S256"),
  resource: z.string().max(2048), scope: z.literal(mcpReadScope).default(mcpReadScope), state: cleanString(1024).optional()
});
const tokenInput = z.object({
  grant_type: z.enum(["authorization_code", "refresh_token"]), client_id: z.string().regex(clientPattern),
  resource: z.string().max(2048), redirect_uri: z.string().max(2048).optional(),
  code: z.string().max(128).optional(), code_verifier: verifierSchema.optional(), refresh_token: z.string().max(128).optional(),
  scope: z.literal(mcpReadScope).optional()
});

function omitEmptyParameters(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== ""));
}

function invalidAuthorization(issues: z.ZodError["issues"]): OAuthRequestError {
  const fields = new Set(issues.map((issue) => issue.path[0]));
  if (fields.has("scope")) return new OAuthRequestError("invalid_scope", "Only workspace:read access is supported.");
  if (fields.has("resource")) return new OAuthRequestError("invalid_request", "Include this MCP server URL as the resource parameter.");
  if (fields.has("code_challenge") || fields.has("code_challenge_method"))
    return new OAuthRequestError("invalid_request", "An S256 PKCE code challenge is required.");
  return new OAuthRequestError("invalid_request", "Use a registered public client, an exact redirect URL and the authorization code flow.");
}

export class McpOAuth {
  readonly issuer: string;
  constructor(readonly repository: McpOAuthRepository, readonly resource: string, readonly appUrl: string) {
    const url = new URL(resource);
    if (url.href !== resource || url.pathname !== "/mcp" || url.search || url.hash || url.username || url.password ||
      !(url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))))
      throw new Error("MCP_PUBLIC_URL must be a canonical HTTPS /mcp URL or a loopback development URL.");
    this.issuer = url.origin;
    const app = new URL(appUrl);
    if (app.username || app.password || app.search || app.hash || !(app.protocol === "https:" ||
      (app.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(app.hostname)))) throw new Error("Invalid MCP consent application URL.");
  }
  metadata() {
    return { issuer: this.issuer, authorization_endpoint: `${this.issuer}/oauth/authorize`, token_endpoint: `${this.issuer}/oauth/token`,
      registration_endpoint: `${this.issuer}/oauth/register`, revocation_endpoint: `${this.issuer}/oauth/revoke`,
      response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [mcpReadScope], authorization_response_iss_parameter_supported: true };
  }
  get logoUrl() { return new URL("/brand/lumora-icon.png", this.appUrl).href; }
  protectedMetadata() { return { resource: this.resource, authorization_servers: [this.issuer], scopes_supported: [mcpReadScope], bearer_methods_supported: ["header"], resource_name: "Lumora" }; }
  async register(input: unknown) {
    const parsed = clientMetadata.safeParse(input);
    if (!parsed.success) throw new OAuthRequestError("invalid_client_metadata", "Register a public PKCE client with exact HTTPS or loopback redirect URLs.");
    const client = await this.repository.register({ id: opaque("lumora_client_"), name: parsed.data.client_name, redirectUris: parsed.data.redirect_uris });
    return { client_id: client.id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: client.name,
      redirect_uris: client.redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: mcpReadScope };
  }
  async start(input: unknown) {
    const parsed = authorizeInput.safeParse(omitEmptyParameters(input));
    if (!parsed.success) throw invalidAuthorization(parsed.error.issues);
    const data = parsed.data;
    if (data.resource !== this.resource) throw new OAuthRequestError("invalid_target", "The resource indicator does not match this MCP server.");
    const client = await this.repository.client(data.client_id);
    if (!client || !client.redirectUris.includes(data.redirect_uri)) throw new OAuthRequestError("invalid_request", "The client or redirect URL is not registered.");
    const request = await this.repository.request({ clientId: client.id, redirectUri: data.redirect_uri,
      challenge: data.code_challenge, resource: data.resource, state: data.state ?? null });
    const url = new URL("/mcp/authorize", this.appUrl); url.searchParams.set("requestId", request.id);
    return url.href;
  }
  async details(id: string) {
    z.uuid().parse(id);
    const request = await this.repository.details(id);
    if (!request) throw new OAuthRequestError("invalid_request", "This authorization request expired or was already completed.", 410);
    return { id, clientName: request.clientName, redirectOrigin: new URL(request.redirectUri).origin,
      expiresAt: request.expiresAt.toISOString(), resource: request.resource, tools: [...mcpReadToolNames] };
  }
  async approve(input: { id: string; tenantId: string; userId: string; tools: McpReadToolName[] }) {
    const code = opaque("lumora_mcp_code_");
    const request = await this.repository.approve({ ...input, codeDigest: digestMcpSecret(code) });
    if (!request) throw new OAuthRequestError("access_denied", "This request or its workspace permissions are no longer available.", 403);
    return this.callback(request, { code });
  }
  async deny(id: string) {
    const request = await this.repository.deny(id);
    if (!request) throw new OAuthRequestError("invalid_request", "This authorization request is no longer available.", 410);
    return this.callback(request, { error: "access_denied" });
  }
  async exchange(input: unknown) {
    const parsed = tokenInput.safeParse(omitEmptyParameters(input));
    if (!parsed.success) throw new OAuthRequestError("invalid_request", "Invalid OAuth token request.");
    const data = parsed.data;
    if (data.resource !== this.resource) throw new OAuthRequestError("invalid_target", "The resource indicator does not match this MCP server.");
    const access = opaque("lumora_mcp_at_"), refresh = opaque("lumora_mcp_rt_");
    const tokens: OAuthTokenPair = { accessDigest: digestMcpSecret(access), refreshDigest: digestMcpSecret(refresh),
      accessExpiresAt: new Date(Date.now() + 10 * 60_000), refreshExpiresAt: new Date(Date.now() + 7 * 86400_000) };
    let valid: boolean;
    if (data.grant_type === "authorization_code") {
      if (!data.code || !codePattern.test(data.code) || !data.redirect_uri || !data.code_verifier || data.refresh_token)
        throw new OAuthRequestError("invalid_request", "A code, exact redirect URL and PKCE verifier are required.");
      valid = await this.repository.exchangeCode({ digest: digestMcpSecret(data.code), clientId: data.client_id,
        redirectUri: data.redirect_uri, resource: data.resource, verifier: data.code_verifier, tokens });
    } else {
      if (!data.refresh_token || !refreshPattern.test(data.refresh_token) || data.code || data.code_verifier || data.redirect_uri)
        throw new OAuthRequestError("invalid_request", "A refresh token is required.");
      valid = await this.repository.refresh({ digest: digestMcpSecret(data.refresh_token), clientId: data.client_id, resource: data.resource, tokens });
    }
    if (!valid) throw new OAuthRequestError("invalid_grant", "The authorization grant is invalid, expired or already used.");
    return { access_token: access, token_type: "Bearer", expires_in: 600, refresh_token: refresh, scope: mcpReadScope };
  }
  async verify(token: string) { return mcpOAuthAccessPattern.test(token) ? this.repository.verify(digestMcpSecret(token), this.resource) : null; }
  async revoke(token: string, clientId?: string) {
    if (mcpOAuthAccessPattern.test(token) || refreshPattern.test(token)) await this.repository.revokeToken(digestMcpSecret(token), clientId);
  }
  private callback(request: { redirectUri: string; state: string | null }, values: Record<string, string>) {
    const url = new URL(request.redirectUri);
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    if (request.state !== null) url.searchParams.set("state", request.state);
    url.searchParams.set("iss", this.issuer);
    return { redirectUrl: url.href };
  }
}
