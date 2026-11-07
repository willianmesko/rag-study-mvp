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
  await assert.rejects(oauth.register({ redirect_uris: ["https://assistant.example/callback"], token_endpoint_auth_method: "client_secret_post" }));
  const client = await oauth.register({ redirect_uris: ["https://assistant.example/callback"], client_name: "Assistant", logo_uri: "https://untrusted.example/logo" });
  assert.equal(client.token_endpoint_auth_method, "none"); assert.equal(registrations, 1);
  assert.equal(await oauth.verify("normal-supabase-token"), null);
});
