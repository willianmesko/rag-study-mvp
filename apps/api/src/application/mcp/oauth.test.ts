import assert from "node:assert/strict";
import test from "node:test";
import { McpOAuth, safeRedirectUri, OAuthRequestError } from "./oauth.js";
import type { McpOAuthRepository } from "./remote-types.js";
import { uniqueOAuthParameters } from "../../interfaces/http/mcp-oauth.js";

test("OAuth permits canonical HTTPS and loopback callbacks, rejecting redirects that carry credentials or token fields", () => {
  for (const url of ["https://assistant.example/callback", "https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:12345/callback", "http://localhost:12345/"]) assert.ok(safeRedirectUri(url), url);
  for (const url of ["javascript:alert(1)", "http://assistant.example/callback", "https://user:pass@example.com/callback", "https://127.0.0.1/callback", "https://example.com/callback#fragment",
    "https://example.com/callback?code=forged", "https://example.com/callback?state=forged", "https://example.com\\@attacker.example/", "https://private.internal/callback"]) assert.equal(safeRedirectUri(url), false, url);
});
test("OAuth rejects duplicate fields and noncanonical resource configuration", () => {
  assert.throws(() => uniqueOAuthParameters("client_id=a&client_id=b"), OAuthRequestError);
  const repo = {} as McpOAuthRepository;
  for (const url of ["https://api.example/mcp/", "https://api.example/mcp?target=other", "http://public.example/mcp", "https://user:pass@api.example/mcp"]) assert.throws(() => new McpOAuth(repo, url, "https://app.example"));
});
test("OAuth metadata publishes PKCE, resource discovery and a public client flow without external metadata fetching", async () => {
  let registrations = 0;
  const oauth = new McpOAuth({ register: async (input) => { registrations++; return { ...input, expiresAt: new Date(Date.now() + 1000) }; } } as McpOAuthRepository,
    "https://api.example/mcp", "https://app.example");
  assert.deepEqual(oauth.metadata().code_challenge_methods_supported, ["S256"]);
  assert.equal(oauth.metadata().authorization_response_iss_parameter_supported, true);
  assert.equal(oauth.protectedMetadata().resource, oauth.resource);
  assert.equal(oauth.logoUrl, "https://app.example/brand/lumora-icon.png");
  await assert.rejects(oauth.register({ redirect_uris: ["https://assistant.example/callback"], token_endpoint_auth_method: "client_secret_post" }));
  const client = await oauth.register({ redirect_uris: ["https://assistant.example/callback"], client_name: "Assistant", logo_uri: "https://untrusted.example/logo" });
  assert.equal(client.token_endpoint_auth_method, "none"); assert.equal(registrations, 1);
  assert.equal(await oauth.verify("normal-supabase-token"), null);
});

const registeredClient = "lumora_client_" + "a".repeat(43);
const requestId = "33000000-0000-4000-8000-000000000001";
const authorizationInput = { response_type: "code", client_id: registeredClient,
  redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect", resource: "https://api.example/mcp",
  code_challenge: "a".repeat(43), code_challenge_method: "S256", state: "fixture-state" };

test("valid OAuth extension parameters do not bypass or break workspace consent", async () => {
  let saved: unknown;
  const oauth = new McpOAuth({
    client: async (id: string) => id === registeredClient ? { id, name: "ChatGPT", redirectUris: [authorizationInput.redirect_uri] } : null,
    request: async (input: unknown) => { saved = input; return { id: requestId }; },
  } as unknown as McpOAuthRepository, authorizationInput.resource, "https://app.example");
  const consent = new URL(await oauth.start({ ...authorizationInput, scope: "", prompt: "consent", response_mode: "query", extension: "ignored" }));
  assert.equal(consent.origin, "https://app.example");
  assert.equal(consent.pathname, "/mcp/authorize");
  assert.equal(consent.searchParams.get("requestId"), requestId);
  assert.deepEqual(saved, { clientId: registeredClient, redirectUri: authorizationInput.redirect_uri,
    challenge: authorizationInput.code_challenge, resource: authorizationInput.resource, state: "fixture-state" });
  assert.equal(consent.searchParams.has("code"), false);
});

test("OAuth compatibility still rejects missing PKCE, audience changes, extra scopes and unknown redirects", async () => {
  let writes = 0;
  const oauth = new McpOAuth({
    client: async () => ({ id: registeredClient, name: "ChatGPT", redirectUris: [authorizationInput.redirect_uri] }),
    request: async () => { writes++; return { id: requestId }; },
  } as unknown as McpOAuthRepository, authorizationInput.resource, "https://app.example");
  for (const input of [
    { ...authorizationInput, resource: undefined }, { ...authorizationInput, resource: "https://other.example/mcp" },
    { ...authorizationInput, code_challenge: undefined }, { ...authorizationInput, code_challenge_method: "plain" },
    { ...authorizationInput, response_type: "token" }, { ...authorizationInput, scope: "workspace:write" },
    { ...authorizationInput, redirect_uri: "https://attacker.example/callback" },
  ]) await assert.rejects(oauth.start({ ...input, prompt: "consent" }), OAuthRequestError);
  assert.equal(writes, 0);
});

test("token exchange ignores extensions while keeping exact resource and PKCE verifier binding", async () => {
  let exchange: unknown;
  const oauth = new McpOAuth({ exchangeCode: async (input: unknown) => { exchange = input; return true; } } as unknown as McpOAuthRepository,
    authorizationInput.resource, "https://app.example");
  const input = { grant_type: "authorization_code", client_id: registeredClient, resource: authorizationInput.resource,
    redirect_uri: authorizationInput.redirect_uri, code: "lumora_mcp_code_" + "b".repeat(43), code_verifier: "v".repeat(43), extension: "ignored" };
  const tokens = await oauth.exchange(input);
  assert.match(tokens.access_token, /^lumora_mcp_at_/);
  assert.ok(exchange && typeof exchange === "object" && "resource" in exchange && exchange.resource === authorizationInput.resource);
  await assert.rejects(oauth.exchange({ ...input, resource: "https://other.example/mcp" }), OAuthRequestError);
  await assert.rejects(oauth.exchange({ ...input, code_verifier: "short" }), OAuthRequestError);
});
