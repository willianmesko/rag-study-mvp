import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { Pool } from "pg";
import Fastify from "fastify";
import { Client, StreamableHTTPClientTransport, auth, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/client";
import { mcpReadToolOutputSchemas, type McpReadToolName } from "@rag-study/contracts";
import { McpOAuth, OAuthRequestError } from "../../application/mcp/oauth.js";
import { McpHybridSearch } from "../../application/mcp/hybrid-search.js";
import { McpReadTools } from "../../application/mcp/read-tools.js";
import { registerMcpOAuthRoutes } from "../../interfaces/http/mcp-oauth.js";
import { registerRemoteMcp } from "../../interfaces/mcp/remote.js";
import { PgMcpOAuthRepository } from "./pg-mcp-oauth-repository.js";
import { PgMcpReadRepository } from "./pg-mcp-read-repository.js";
import { PgMcpControls, type McpControlLimits } from "./pg-mcp-controls.js";
import { PgAuditEventRepository } from "./pg-audit-event-repository.js";

const databaseUrl = process.env.MCP_TEST_DATABASE_URL;
const signal = new AbortController().signal;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
test("remote MCP OAuth, hybrid search and budgets hold across concurrent database clients", { skip: !databaseUrl, timeout: 45_000 }, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl!).hostname), "Use a disposable local database.");
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const readPool = new Pool({ connectionString: databaseUrl, max: 2 });
  const tenantId = randomUUID(), otherTenantId = randomUUID(), userId = randomUUID();
  const repository = new PgMcpOAuthRepository(pool);
  const reads = new PgMcpReadRepository(readPool);
  const limits: McpControlLimits = { callsPerMinute: 100, callsPerDay: 400, providerCallsPerDay: 100, inputTokensPerDay: 100000,
    userCostNanoUsdPerDay: 10000000, tenantCostNanoUsdPerDay: 50000000, concurrentProviders: 2 };
  const controls = new PgMcpControls(pool, limits);
  const app = Fastify({ logger: false });
  const shutdown = new AbortController();
  const registered: string[] = [];
  const clients: Client[] = [];
  let providerCalls = 0, providerMode: "normal" | "wait" = "normal", providerCancelled = false;
  const vector = [1, ...Array(1023).fill(0)];
  t.after(async () => {
    shutdown.abort(); await Promise.all(clients.map((client) => client.close().catch(() => {}))); await app.close(); await readPool.end();
    try {
      await pool.query("DELETE FROM mcp_oauth_clients WHERE id=ANY($1::text[])", [registered]);
      for (const table of ["documents", "tenant_memberships", "tenants"]) await pool.query(`DELETE FROM ${table} WHERE ${table === "tenants" ? "id" : "tenant_id"}=ANY($1::uuid[])`, [[tenantId, otherTenantId]]);
    } finally { await pool.end(); }
  });
  await pool.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,'MCP OAuth fixture'),($3,$4,'Other MCP OAuth fixture')", [tenantId,"mcp-"+tenantId,otherTenantId,"mcp-"+otherTenantId]);
  await pool.query("INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'owner'),($3,$2,'viewer')", [tenantId,userId,otherTenantId]);
  await pool.query("INSERT INTO workspace_embedding_versions(tenant_id,provider,model,dimensions,state) VALUES($1,'openrouter','priced-fixture',1024,'active')", [tenantId]);
  const { rows: [document] } = await pool.query<{ id: string }>("INSERT INTO documents(tenant_id,source,title) VALUES($1,'https://example.com/handbook','Team handbook') RETURNING id", [tenantId]);
  await pool.query("INSERT INTO chunks(document_id,ordinal,content,embedding,metadata) VALUES($1,0,'Staff vacations require manager approval. Contact hr@example.com.',$2::vector,$3::jsonb)",
    [document!.id,JSON.stringify(vector),JSON.stringify({ security: { promptInjectionRisk: "low", signals: [] } })]);
  // The other workspace has a better exact lexical match, which must stay hidden.
  const { rows: [other] } = await pool.query<{ id: string }>("INSERT INTO documents(tenant_id,source,title) VALUES($1,'private/hidden.pdf','Hidden workspace') RETURNING id", [otherTenantId]);
  await pool.query("INSERT INTO chunks(document_id,ordinal,content,embedding,metadata) VALUES($1,0,'Annual leave entitlement secret',$2::vector,'{}')", [other!.id,JSON.stringify(vector)]);

  await app.listen({ host: "127.0.0.1", port: 0 });
  // Routes must be registered before listen: use a separate lightweight URL probe.
  const bound = app.server.address(); assert.ok(bound && typeof bound !== "string");
  await app.close();
  // A fixed local ephemeral test port is selected by the OS, then the actual
  // app binds it after the canonical OAuth resource is known.
  const api = Fastify({ logger: false });
  const base = `http://127.0.0.1:${bound.port}`;
  const oauth = new McpOAuth(repository, `${base}/mcp`, "http://127.0.0.1:4173");
  const audit = new PgAuditEventRepository(pool);
  const hybrid = new McpHybridSearch(reads, controls, () => ({ embed: async (_query, _type, providerSignal) => {
    providerCalls++;
    if (providerMode === "wait") await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 10000);
      providerSignal!.addEventListener("abort", () => { providerCancelled = true; clearTimeout(timer); reject(providerSignal!.reason); }, { once: true });
    });
    return vector;
  } }), [{ provider: "openrouter", model: "priced-fixture", dimensions: 1024, inputCostPer1kUsd: 0.001 }], { maxInputTokens: 2048, maxCostNanoUsd: 5000000 });
  registerMcpOAuthRoutes(api, { oauth, audit: audit.record.bind(audit), authorizeUser: async () => ({ ok: true, userId }),
    authorize: async (request) => {
      const tenant = request.headers["x-workspace-id"];
      if (typeof tenant !== "string") return { ok: false, status: 400, error: "Select a workspace." };
      const { rows: [member] } = await pool.query<{ role: "owner" | "viewer" }>("SELECT role FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2", [tenant,userId]);
      return member ? { ok: true, tenantId: tenant, userId, role: member.role } : { ok: false, status: 403, error: "Membership required." };
    }
  });
  registerRemoteMcp(api, { oauth, tools: new McpReadTools(reads, hybrid), controls, audit: audit.record.bind(audit), shutdown: shutdown.signal });
  await api.listen({ host: "127.0.0.1", port: bound.port });
  t.after(() => api.close());
  const clientMetadata = await oauth.register({ client_name: "Integration assistant", redirect_uris: ["http://127.0.0.1:12345/callback"] });
  registered.push(clientMetadata.client_id);

  async function authorization(tools: McpReadToolName[] = ["list_sources", "get_document", "search_workspace"], workspace = tenantId) {
    const verifier = randomBytes(32).toString("base64url");
    const params = new URLSearchParams({ response_type: "code", client_id: clientMetadata.client_id, redirect_uri: clientMetadata.redirect_uris[0]!,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource: oauth.resource, state: "opaque-client-state" });
    const response = await fetch(`${base}/oauth/authorize?${params}`, { redirect: "manual" });
    assert.equal(response.status, 303);
    const requestId = new URL(response.headers.get("location")!).searchParams.get("requestId")!;
    const approved = await fetch(`${base}/v1/mcp/oauth/requests/${requestId}/approve`, { method: "POST", headers: { "x-workspace-id": workspace, "content-type": "application/json" }, body: JSON.stringify({ tools }) });
    assert.equal(approved.status, 200);
    const redirect = new URL((await approved.json() as { redirectUrl: string }).redirectUrl);
    assert.equal(redirect.searchParams.get("state"), "opaque-client-state"); assert.equal(redirect.searchParams.get("iss"), base);
    return { grant_type: "authorization_code", client_id: clientMetadata.client_id, redirect_uri: clientMetadata.redirect_uris[0]!, resource: oauth.resource,
      code: redirect.searchParams.get("code")!, code_verifier: verifier };
  }
  async function exchange(body: Record<string,string>) {
    const response = await fetch(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
    assert.equal(response.status, 200);
    return await response.json() as { access_token: string; refresh_token: string };
  }

  await t.test("code exchange requires correct verifier, audience, redirect and client; replay revokes the grant", async () => {
    const code = await authorization();
    await assert.rejects(oauth.exchange({ ...code, code_verifier: "x".repeat(43) }), OAuthRequestError);
    await assert.rejects(oauth.exchange({ ...code, resource: "https://other.example/mcp" }), OAuthRequestError);
    await assert.rejects(oauth.exchange({ ...code, redirect_uri: "http://localhost:12345/callback" }), OAuthRequestError);
    const pair = await exchange(code);
    assert.equal((await oauth.verify(pair.access_token))?.tenantId, tenantId);
    await assert.rejects(oauth.exchange(code), OAuthRequestError);
    assert.equal(await oauth.verify(pair.access_token), null);
  });
  await t.test("concurrent code redemption permits one exchange and revokes the replayed family", async () => {
    const code = await authorization();
    const outcomes = await Promise.allSettled([oauth.exchange(code), oauth.exchange(code)]);
    const successful = outcomes.filter((item) => item.status === "fulfilled"); assert.equal(successful.length, 1);
    if (successful[0]?.status === "fulfilled") assert.equal(await oauth.verify(successful[0].value.access_token), null);
  });
  await t.test("rotating refresh tokens resist concurrent redemption and revoke reuse", async () => {
    const pair = await exchange(await authorization());
    const body = { grant_type: "refresh_token", client_id: clientMetadata.client_id, resource: oauth.resource, refresh_token: pair.refresh_token };
    const outcomes = await Promise.allSettled([oauth.exchange(body), oauth.exchange(body)]);
    assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(await oauth.verify(pair.access_token), null);
    for (const item of outcomes) if (item.status === "fulfilled") assert.equal(await oauth.verify(item.value.access_token), null);
  });
  await t.test("the SDK discovers the URL, registers through HTTP, completes PKCE consent and refreshes tokens", async () => {
    let info: Awaited<ReturnType<OAuthClientProvider["clientInformation"]>>;
    let tokens: Awaited<ReturnType<OAuthClientProvider["tokens"]>>;
    let discovery: OAuthDiscoveryState | undefined;
    let verifier = "", destination: URL | undefined;
    const provider: OAuthClientProvider = {
      redirectUrl: "http://127.0.0.1:12345/callback",
      clientMetadata: { client_name: "SDK OAuth assistant", redirect_uris: ["http://127.0.0.1:12345/callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code","refresh_token"], response_types: ["code"] },
      clientInformation: () => info, saveClientInformation: (value) => { info=value; registered.push(value.client_id); },
      tokens: () => tokens, saveTokens: (value) => { tokens=value; },
      redirectToAuthorization: (value) => { destination=value; }, saveCodeVerifier: (value) => { verifier=value; }, codeVerifier: () => verifier,
      saveDiscoveryState: (value) => { discovery=value; }, discoveryState: () => discovery
    };
    assert.equal(await auth(provider, { serverUrl: oauth.resource }), "REDIRECT");
    assert.ok(destination); assert.ok(info); assert.ok(verifier);
    const consent = await fetch(destination, { redirect: "manual" }); assert.equal(consent.status,303);
    const id = new URL(consent.headers.get("location")!).searchParams.get("requestId")!;
    const approved = await fetch(`${base}/v1/mcp/oauth/requests/${id}/approve`, { method: "POST", headers: { "x-workspace-id": tenantId, "content-type": "application/json" }, body: JSON.stringify({ tools: ["list_sources"] }) });
    assert.equal(approved.status,200);
    const callback = new URL((await approved.json() as { redirectUrl: string }).redirectUrl);
    assert.equal(await auth(provider, { serverUrl: oauth.resource, authorizationCode: callback.searchParams.get("code")!, iss: callback.searchParams.get("iss")! }), "AUTHORIZED");
    const first = tokens!.access_token; assert.ok(await oauth.verify(first));
    // Force the SDK refresh branch rather than a still-valid local token hit.
    tokens = { ...tokens!, expires_in: 0 };
    assert.equal(await auth(provider, { serverUrl: oauth.resource }), "AUTHORIZED");
    assert.notEqual(tokens!.access_token, first); assert.ok(await oauth.verify(tokens!.access_token));
  });
  await t.test("MCP SDK clients negotiate modern and legacy protocols and get only scoped, consented tools", async () => {
    const pair = await exchange(await authorization());
    for (const mode of ["auto", "legacy"] as const) {
      const client = new Client({ name: "lumora-remote-test", version: "1.0.0" }, { versionNegotiation: { mode } }); clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(oauth.resource), { authProvider: { token: async () => pair.access_token } }));
      assert.equal((await client.listTools()).tools.length, 3);
      const sources = await client.callTool({ name: "list_sources", arguments: {} });
      assert.equal(mcpReadToolOutputSchemas.list_sources.parse(sources.structuredContent).sources[0]?.id, document!.id);
      // Semantic candidate has no exact "annual leave" phrase. The lexical
      // match in another workspace must never cross the tenant boundary.
      const result = await client.callTool({ name: "search_workspace", arguments: { query: "annual leave entitlement" } });
      const hits = mcpReadToolOutputSchemas.search_workspace.parse(result.structuredContent).results;
      assert.equal(hits.length, 1); assert.equal(hits[0]?.documentId, document!.id); assert.equal(hits[0]?.similarity, 1);
      assert.match(hits[0]!.excerpt, /REDACTED_EMAIL/); assert.ok(!hits[0]!.excerpt.includes("secret"));
      await client.close();
    }
  });
  await t.test("provider reservations and call quotas stay atomic across concurrent requests", async () => {
    const tight = new PgMcpControls(pool, { ...limits, concurrentProviders: 1, callsPerMinute: 2, userCostNanoUsdPerDay: 5 });
    const started = await Promise.all(Array.from({ length: 5 }, () => tight.reserve({ tenantId: otherTenantId, userId, inputTokens: 1, costNanoUsd: 4, signal })));
    assert.equal(started.filter(Boolean).length, 1);
    await tight.finishReservation(started.find(Boolean)!);
    assert.equal(await tight.reserve({ tenantId: otherTenantId, userId, inputTokens: 1, costNanoUsd: 4, signal }), null);
    const calls = await Promise.all(Array.from({ length: 5 }, () => tight.admit(otherTenantId,userId,signal)));
    assert.equal(calls.filter(Boolean).length, 2);
    const rows = await pool.query("SELECT calls,cost_nano_usd::text FROM workspace_mcp_provider_usage WHERE tenant_id=$1", [otherTenantId]);
    assert.deepEqual(rows.rows, [{ calls: 1, cost_nano_usd: "4" }]);
  });
  await t.test("a protocol cancellation reaches the embedding provider and no search result is released", async () => {
    const pair = await exchange(await authorization());
    providerMode = "wait"; providerCancelled = false;
    const before = providerCalls;
    const headers = { authorization: `Bearer ${pair.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" };
    const resultPromise = fetch(oauth.resource, { method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: "cancel-test", method: "tools/call", params: { name: "search_workspace", arguments: { query: "policy" } } }) });
    for (let count=0; count<50 && providerCalls===before; count++) await sleep(20);
    assert.equal(providerCalls, before+1);
    const cancelled = await fetch(oauth.resource, { method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "cancel-test" } }) });
    assert.equal(cancelled.status, 202);
    const result = await resultPromise; const text = await result.text();
    assert.equal(providerCancelled, true); assert.match(text, /tool_cancelled/); assert.ok(!text.includes("hr@example.com"));
    providerMode = "normal";
  });
  await t.test("revocation, current membership and owner role are rechecked instead of trusting token claims", async () => {
    const pair = await exchange(await authorization(["get_quality_report"]));
    const principal = (await oauth.verify(pair.access_token))!;
    const id = await controls.begin({ principal, requestKey: "a".repeat(64), tool: "get_quality_report", timeoutMs: 8000 });
    assert.equal(await controls.alive(id!), true);
    await pool.query("UPDATE tenant_memberships SET role='viewer' WHERE tenant_id=$1 AND user_id=$2", [tenantId,userId]);
    assert.equal(await controls.alive(id!), false);
    await pool.query("UPDATE tenant_memberships SET role='owner' WHERE tenant_id=$1 AND user_id=$2", [tenantId,userId]);
    await repository.revokeGrant(userId,otherTenantId,principal.grantId);
    assert.ok(await oauth.verify(pair.access_token));
    await repository.revokeGrant(userId,tenantId,principal.grantId);
    assert.equal(await oauth.verify(pair.access_token), null); assert.equal(await controls.alive(id!), false);
  });
  await t.test("removing and rejoining a membership cannot refund costs or reset call quotas", async () => {
    const tight = new PgMcpControls(pool, { ...limits, callsPerMinute: 2, userCostNanoUsdPerDay: 5 });
    await pool.query("DELETE FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2", [otherTenantId,userId]);
    const accounting = await pool.query("SELECT calls,cost_nano_usd::text FROM workspace_mcp_provider_usage WHERE tenant_id=$1", [otherTenantId]);
    assert.deepEqual(accounting.rows, [{ calls: 1, cost_nano_usd: "4" }]);
    assert.equal(await tight.admit(otherTenantId,userId,signal), false);
    await pool.query("INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'viewer')", [otherTenantId,userId]);
    assert.equal(await tight.reserve({ tenantId: otherTenantId,userId,inputTokens: 1,costNanoUsd: 4,signal }), null);
    assert.equal(await tight.admit(otherTenantId,userId,signal), false);
  });
  await t.test("new authorization and budget tables are private, with hashes and no raw prompts or OAuth credentials in audits", async () => {
    const names = ["mcp_oauth_clients","mcp_oauth_grants","mcp_oauth_requests","mcp_oauth_tokens","workspace_mcp_call_usage","workspace_mcp_provider_usage","workspace_mcp_provider_reservations","workspace_mcp_executions"];
    const { rows } = await pool.query("SELECT relname,relrowsecurity AS rls,has_table_privilege('anon',oid,'SELECT') AS anon,has_table_privilege('authenticated',oid,'SELECT') AS authenticated FROM pg_class WHERE relname=ANY($1::text[])", [names]);
    assert.equal(rows.length, 8); assert.ok(rows.every((row) => row.rls && !row.anon && !row.authenticated));
    const auditRows = await pool.query("SELECT metadata FROM audit_events WHERE tenant_id=$1", [tenantId]);
    const text = JSON.stringify(auditRows.rows);
    for (const secret of ["annual leave entitlement","hr@example.com","lumora_mcp_at_","lumora_mcp_rt_","code_verifier","opaque-client-state"]) assert.ok(!text.includes(secret));
    assert.ok(auditRows.rowCount! > 8);
  });
});
