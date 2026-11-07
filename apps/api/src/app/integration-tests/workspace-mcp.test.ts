import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mcpReadToolInputSchemas, type McpReadToolName } from "@rag-study/contracts";
import type { AuditEventRepository } from "../../modules/usage/application/ports/audit-event-repository.js";
import { config } from "../../config.js";
import { buildApp } from "../http-server.js";

const tenantId = "11000000-0000-4000-8000-000000000001";
const otherTenantId = "11000000-0000-4000-8000-000000000002";
const userId = "22000000-0000-4000-8000-000000000001";
const mcpToken = `lumora_mcp_${"a".repeat(43)}`;
const userHeaders = { authorization: "Bearer signed-in-fixture", "x-workspace-id": tenantId };
const toolHeaders = { authorization: `Bearer ${mcpToken}`, "x-workspace-id": tenantId };

async function fixture(t: TestContext, options: { role?: "owner" | "viewer"; allowed?: boolean; auditFails?: boolean; result?: unknown } = {}) {
  const overrides = { SUPABASE_URL: "https://mcp-auth.example.test", SUPABASE_PUBLISHABLE_KEY: "fixture-public", API_KEY: undefined };
  const saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, config[key as keyof typeof config]]));
  Object.assign(config, overrides);
  t.after(() => Object.assign(config, saved));
  t.mock.method(globalThis, "fetch", async (address: string) => {
    assert.equal(String(address), "https://mcp-auth.example.test/auth/v1/user");
    return Response.json({ id: userId, aud: "authenticated", role: "authenticated" });
  });
  const issue = t.mock.fn(async () => ({ token: mcpToken, workspaceId: tenantId, expiresAt: "2026-11-07T05:00:00.000Z" }));
  const revoke = t.mock.fn(async () => {});
  const audit = t.mock.fn(async (_event: Parameters<AuditEventRepository["record"]>[0]) => {
    if (options.auditFails) throw new Error("Audit offline");
  });
  const execute = t.mock.fn(async (input: { tool: McpReadToolName; tenantId: string; role: string; arguments: unknown; signal: AbortSignal }) => {
    assert.equal(input.tenantId, tenantId);
    mcpReadToolInputSchemas[input.tool].parse(input.arguments);
    return options.result ?? { sources: [] };
  });
  const app = await buildApp({
    workspaceMcp: {
      controls: { admit: async () => true },
      access: {
        issue, revoke, status: async () => ({ expiresAt: null }),
        validate: async () => ({ tenantId, userId, role: options.role ?? "viewer", allowed: true }),
        admit: async (requested: string) => requested === tenantId ? {
          tenantId, userId, role: options.role ?? "viewer", allowed: options.allowed ?? true
        } : null
      },
      tools: { execute }
    },
    findMembership: async (actor: string, tenant: string) => actor === userId && tenant === tenantId
      ? { tenantId, tenantName: "Legal", tenantSlug: "legal", role: options.role ?? "viewer" } : null,
    recordAuditEvent: audit
  } as unknown as Parameters<typeof buildApp>[0]);
  t.after(() => app.close());
  return { app, execute, audit, issue, revoke };
}

test("MCP access issuance requires a signed-in member and explicit workspace", async (t) => {
  const { app, issue } = await fixture(t);
  const request = { method: "POST" as const, url: "/v1/mcp/access" };
  assert.equal((await app.inject(request)).statusCode, 401);
  assert.equal((await app.inject({ ...request, headers: { authorization: userHeaders.authorization } })).statusCode, 400);
  assert.equal((await app.inject({ ...request, headers: { ...userHeaders, "x-workspace-id": otherTenantId } })).statusCode, 403);
  const accepted = await app.inject({ ...request, headers: userHeaders });
  assert.equal(accepted.statusCode, 201);
  assert.equal(accepted.json().token, mcpToken);
  assert.equal(issue.mock.callCount(), 1);
});

test("an MCP credential cannot issue or revoke credentials", async (t) => {
  const { app, issue, revoke } = await fixture(t);
  assert.equal((await app.inject({ method: "POST", url: "/v1/mcp/access", headers: toolHeaders })).statusCode, 401);
  assert.equal((await app.inject({ method: "DELETE", url: "/v1/mcp/access", headers: toolHeaders })).statusCode, 401);
  assert.equal(issue.mock.callCount(), 0);
  assert.equal(revoke.mock.callCount(), 0);
});

test("MCP calls reject normal session tokens, workspace mismatch, writes and role escalation", async (t) => {
  const { app, execute, audit } = await fixture(t);
  const request = { method: "POST" as const, url: "/v1/mcp/tools/list_sources", payload: {} };
  assert.equal((await app.inject({ ...request, headers: userHeaders })).statusCode, 401);
  assert.equal((await app.inject({ ...request, headers: { ...toolHeaders, "x-workspace-id": otherTenantId } })).statusCode, 401);
  assert.equal((await app.inject({ ...request, headers: toolHeaders, url: "/v1/mcp/tools/run_evaluation" })).statusCode, 403);
  assert.equal((await app.inject({ ...request, headers: toolHeaders, url: "/v1/mcp/tools/get_quality_report" })).statusCode, 403);
  assert.equal(execute.mock.callCount(), 0);
  assert.equal(audit.mock.callCount(), 2);
});

test("MCP validates inputs, caps outputs and records reason-only audit events", async (t) => {
  const { app, execute, audit } = await fixture(t);
  const request = { method: "POST" as const, url: "/v1/mcp/tools/list_sources", headers: toolHeaders };
  assert.equal((await app.inject({ ...request, payload: { limit: 50, tenantId: otherTenantId } })).statusCode, 400);
  const accepted = await app.inject({ ...request, payload: { limit: 2 } });
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(accepted.json(), { result: { sources: [] } });
  assert.equal(execute.mock.callCount(), 2);
  const events = audit.mock.calls.map(({ arguments: [event] }) => event);
  assert.deepEqual(events.map(({ metadata }) => metadata), [
    { tool: "list_sources", outcome: "invalid_input" }, { tool: "list_sources", outcome: "completed" }
  ]);
  assert.ok(!JSON.stringify(events).includes(mcpToken));
  assert.ok(!JSON.stringify(events).includes(otherTenantId));
});

test("an exhausted MCP credential stops before reading workspace content", async (t) => {
  const { app, execute, audit } = await fixture(t, { allowed: false });
  const response = await app.inject({ method: "POST", url: "/v1/mcp/tools/list_sources", headers: toolHeaders, payload: {} });
  assert.equal(response.statusCode, 429);
  assert.equal(execute.mock.callCount(), 0);
  assert.equal(audit.mock.calls[0]?.arguments[0].metadata.outcome, "tool_limit_reached");
});

test("MCP fails closed when safe output or its audit cannot be verified", async (t) => {
  const { app } = await fixture(t, { result: { sources: [], secret: "do-not-return" } });
  const response = await app.inject({ method: "POST", url: "/v1/mcp/tools/list_sources", headers: toolHeaders, payload: {} });
  assert.equal(response.statusCode, 503);
  assert.ok(!response.body.includes("do-not-return"));
});

test("MCP never releases successful output after an audit failure", async (t) => {
  const { app } = await fixture(t, { auditFails: true });
  const response = await app.inject({ method: "POST", url: "/v1/mcp/tools/list_sources", headers: toolHeaders, payload: {} });
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().result, undefined);
});
