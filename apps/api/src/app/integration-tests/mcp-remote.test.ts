import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { McpOAuth } from "../../modules/mcp/application/oauth.js";
import type { McpOAuthRepository, McpPrincipal } from "../../modules/mcp/application/remote-types.js";
import { parseRuntimeConfiguration } from "../configuration/environment.js";
import { buildApp } from "../http-server.js";

const tenantId = "11000000-0000-4000-8000-000000000001";
const userId = "22000000-0000-4000-8000-000000000001";
const token = "lumora_mcp_at_" + "a".repeat(43);
const headers = { host: "api.example", authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" };
async function fixture(t: TestContext, options: { denied?: boolean; auditFails?: boolean } = {}) {
  const configuration = parseRuntimeConfiguration({ API_KEY: "fixture-api-key-for-normal-apis",
    ALLOWED_ORIGINS: "https://app.example", MCP_REMOTE_ALLOWED_ORIGINS: "https://trusted-assistant.example" });
  const principal: McpPrincipal = { tenantId, userId, grantId: tenantId, clientId: "client", role: "viewer", allowedTools: ["list_sources"], expiresAt: new Date(Date.now() + 600000) };
  const oauth = new McpOAuth({ verify: async () => principal } as unknown as McpOAuthRepository, "https://api.example/mcp", "https://app.example");
  const execute = t.mock.fn(async () => ({ sources: [] }));
  const audit = t.mock.fn(async () => { if (options.auditFails) throw new Error("audit unavailable"); });
  const controls = { admit: async () => !options.denied, begin: async () => tenantId, alive: async () => true, finish: async () => {}, cancel: t.mock.fn(async () => {}) };
  const app = await buildApp({ remoteMcp: { oauth, tools: { execute }, controls }, recordAuditEvent: audit } as unknown as Parameters<typeof buildApp>[0], { configuration, isProduction: true });
  t.after(() => app.close());
  return { app, execute, audit, controls };
}
test("remote MCP discovery works without the normal API key and rejects Host/Origin rebinding", async (t) => {
  const { app } = await fixture(t);
  const metadata = await app.inject({ url: "/.well-known/oauth-authorization-server", headers: { host: "api.example" } });
  assert.equal(metadata.statusCode, 200); assert.equal(metadata.json().issuer, "https://api.example");
  const protectedMetadata = await app.inject({ url: "/.well-known/oauth-protected-resource/mcp", headers: { host: "api.example" } });
  assert.equal(protectedMetadata.json().resource_name, "Lumora");
  assert.equal((await app.inject({ url: "/v1/mcp/access", headers: { host: "api.example" } })).statusCode, 401);
  assert.equal((await app.inject({ url: "/.well-known/oauth-authorization-server", headers: { host: "attacker.example" } })).statusCode, 403);
  assert.equal((await app.inject({ url: "/mcp", headers: { ...headers, origin: "https://attacker.example" } })).statusCode, 403);
  const cors = await app.inject({ method: "OPTIONS", url: "/mcp", headers: { host: "api.example", origin: "https://trusted-assistant.example" } });
  assert.equal(cors.statusCode, 204); assert.match(String(cors.headers["access-control-expose-headers"]), /www-authenticate/);
});
test("MCP initialization advertises Lumora's public product identity and icon", async (t) => {
  const { app } = await fixture(t);
  const response = await app.inject({ method: "POST", url: "/mcp", headers,
    payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fixture", version: "1" } } } });
  assert.equal(response.statusCode, 200);
  const message = response.headers["content-type"]?.includes("text/event-stream")
    ? JSON.parse(response.payload.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) : response.json();
  assert.equal(message.result.serverInfo.title, "Lumora");
  assert.deepEqual(message.result.serverInfo.icons, [{ src: "https://app.example/brand/lumora-icon.png", mimeType: "image/png", sizes: ["256x256"] }]);
});
test("remote MCP rejects normal session tokens, workspace overrides, writes and unapproved tools", async (t) => {
  const { app, execute, audit } = await fixture(t);
  const challenge = await app.inject({ method: "POST", url: "/mcp", headers: { host: "api.example", authorization: "Bearer normal-supabase-token" }, payload: {} });
  assert.equal(challenge.statusCode, 401); assert.match(String(challenge.headers["www-authenticate"]), /resource_metadata=/);
  const call = { method: "POST" as const, url: "/mcp", headers, payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_quality_report", arguments: {} } } };
  assert.equal((await app.inject({ ...call, headers: { ...headers, "x-workspace-id": userId } })).statusCode, 403);
  assert.equal((await app.inject(call)).statusCode, 403);
  assert.equal((await app.inject({ ...call, payload: { ...call.payload, params: { name: "run_evaluation", arguments: {} } } })).statusCode, 403);
  assert.equal(execute.mock.callCount(), 0); assert.equal(audit.mock.callCount(), 2);
});
test("remote MCP screens arguments, limits all credential families together and audits successful reads", async (t) => {
  const { app, execute, audit } = await fixture(t);
  const payload = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_sources", arguments: { tenantId: userId } } };
  assert.equal((await app.inject({ method: "POST", url: "/mcp", headers, payload })).statusCode, 400);
  const result = await app.inject({ method: "POST", url: "/mcp", headers, payload: { ...payload, params: { name: "list_sources", arguments: {} } } });
  assert.equal(result.statusCode, 200); assert.match(result.payload, /structuredContent/);
  assert.equal(execute.mock.callCount(), 1); assert.equal(audit.mock.callCount(), 2);
  assert.ok(!JSON.stringify(audit.mock.calls).includes(token));
});
test("remote MCP fails closed when the shared call budget or mandatory audit is unavailable", async (t) => {
  const { app, execute } = await fixture(t, { denied: true });
  const result = await app.inject({ method: "POST", url: "/mcp", headers, payload: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  assert.equal(result.statusCode, 429); assert.equal(execute.mock.callCount(), 0);
});
test("OAuth form parsing rejects duplicate parameters and never reflects provider errors", async (t) => {
  const { app } = await fixture(t);
  const result = await app.inject({ method: "POST", url: "/oauth/token", headers: { host: "api.example", "content-type": "application/x-www-form-urlencoded" }, payload: "client_id=one&client_id=two" });
  assert.equal(result.statusCode, 400); assert.equal(result.json().error, "invalid_request");
});
test("remote MCP withholds successful data when the mandatory audit fails", async (t) => {
  const { app } = await fixture(t, { auditFails: true });
  const result = await app.inject({ method: "POST", url: "/mcp", headers,
    payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_sources", arguments: {} } } });
  assert.match(result.payload, /policy_unavailable/); assert.ok(!result.payload.includes("structuredContent"));
  assert.ok(!result.payload.includes("audit unavailable"));
});
