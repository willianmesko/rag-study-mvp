import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mcpReadToolOutputSchemas } from "@rag-study/contracts";
import Fastify from "fastify";
import { Pool, type PoolClient } from "pg";
import { McpAccess } from "../../application/access.js";
import { McpReadTools } from "../../application/read-tools.js";
import { registerWorkspaceMcpRoutes } from "../../workspace-mcp.controller.js";
import { PgAuditEventRepository } from "../../../usage/infrastructure/postgres/pg-audit-event-repository.js";
import { PgMcpAccessRepository } from "./pg-mcp-access-repository.js";
import { PgMcpReadRepository } from "./pg-mcp-read-repository.js";
import { PgMcpControls } from "./pg-mcp-controls.js";

const databaseUrl = process.env.MCP_TEST_DATABASE_URL;
const root = fileURLToPath(new URL("../../../../../../../", import.meta.url));
const options = { skip: !databaseUrl, timeout: 30_000 };
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

test("PostgreSQL enforces MCP scope, credentials and the complete tool transport", options, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl!).hostname), "Use a disposable local database.");
  const pool = new Pool({ connectionString: databaseUrl, max: 3 });
  const readApplication = "lumora_mcp_test_" + randomUUID();
  const readPool = new Pool({ connectionString: databaseUrl, max: 1, application_name: readApplication });
  const reads = new PgMcpReadRepository(readPool);
  const accessRepository = new PgMcpAccessRepository(pool);
  const access = new McpAccess(accessRepository);
  const tenantId = randomUUID();
  const otherTenant = randomUUID();
  const userId = randomUUID();
  const rateUserId = randomUUID();
  const otherUserId = randomUUID();
  const scope = { tenantId, userId };
  const signal = new AbortController().signal;
  const api = Fastify({ logger: false });
  const shutdown = new AbortController();
  const client = new Client({ name: "lumora-pg-integration", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  let lock: PoolClient | undefined;
  t.after(async () => {
    if (lock) {
      await lock.query("ROLLBACK").catch(() => undefined);
      lock.release();
    }
    await client.close();
    shutdown.abort();
    await api.close();
    await readPool.end();
    try {
      for (const table of ["ingestion_jobs", "documents", "evaluation_runs", "tenant_memberships", "tenants"]) {
        const column = table === "tenants" ? "id" : "tenant_id";
        await pool.query("DELETE FROM " + table + " WHERE " + column + " = ANY($1::uuid[])", [[tenantId, otherTenant]]);
      }
    } finally {
      await pool.end();
    }
  });

  await pool.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,'MCP fixture'),($3,$4,'Other MCP fixture')",
    [tenantId, "mcp-test-" + tenantId, otherTenant, "mcp-test-" + otherTenant]);
  await pool.query(
    "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'viewer'),($1,$4,'viewer'),($5,$2,'viewer')",
    [tenantId, userId, rateUserId, otherUserId, otherTenant]
  );
  async function seedDocument(workspace: string) {
    const { rows: [document] } = await pool.query<{ id: string }>(
      "INSERT INTO documents(tenant_id,source,title,metadata) VALUES($1,'https://example.com/mcp-fixture','Access policy',$2) RETURNING id",
      [workspace, JSON.stringify({ format: "html", language: "en" })]
    );
    const vector = "[" + [1, ...Array(1_023).fill(0)].join(",") + "]";
    await pool.query(
      "INSERT INTO chunks(document_id,ordinal,content,embedding,metadata) VALUES($1,0,'Policy contacts support@example.com. Managers approve access.',$2::vector,$3)",
      [document!.id, vector, JSON.stringify({ security: { promptInjectionRisk: "low", signals: [] } })]
    );
    return document!.id;
  }
  const documentId = await seedDocument(tenantId);
  await seedDocument(otherTenant);
  const { rows: [job] } = await pool.query<{ id: string }>(
    "INSERT INTO ingestion_jobs(tenant_id,source,filename,mime_type,status,progress,document_id) VALUES($1,'mcp-fixture','source.html','text/html','completed',100,$2) RETURNING id",
    [tenantId, documentId]
  );
  await pool.query(
    "INSERT INTO evaluation_runs(tenant_id,dataset_name,dataset_version,embedding_provider,embedding_model,chat_provider,chat_model,total_cases,hit_rate,mean_reciprocal_rank,injection_pass_rate,passed,duration_ms) VALUES($1,'mcp-fixture','v1','none','none','none','none',4,1,1,1,true,15)",
    [tenantId]
  );

  await t.test("repository reads stay inside the selected tenant and a read-only transaction", async () => {
    assert.equal((await reads.listSources(tenantId, 10, signal)).length, 1);
    assert.equal(await reads.getDocument(otherTenant, documentId, 3, signal), null);
    assert.equal(await reads.getIngestionStatus(otherTenant, job!.id, signal), null);
    assert.equal((await reads.getQualityReport(otherTenant, 3, signal)).length, 0);
    const matches = await reads.search(tenantId, "policy", 5, signal);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.documentId, documentId);
    // Probe the transaction boundary with an attempted write.
    const transaction = reads as unknown as {
      read<Result>(abort: AbortSignal, query: (connection: PoolClient) => Promise<Result>): Promise<Result>;
    };
    await assert.rejects(transaction.read(signal,
      (connection) => connection.query("DELETE FROM documents WHERE tenant_id=$1", [tenantId])), { code: "25006" });
    assert.equal((await reads.listSources(tenantId, 10, signal)).length, 1);
  });

  await t.test("credential rotation, concurrent budgets, expiry and membership are atomic", async () => {
    const rateScope = { tenantId, userId: rateUserId };
    const first = await access.issue(rateScope);
    const { rows: [stored] } = await pool.query<{ token_digest: Buffer }>(
      "SELECT token_digest FROM workspace_mcp_access WHERE tenant_id=$1 AND user_id=$2", [tenantId, rateUserId]
    );
    assert.ok(stored!.token_digest.equals(createHash("sha256").update(first.token).digest()));
    assert.equal(await access.admit(otherTenant, first.token), null);
    const parallel = await Promise.all(Array.from({ length: 12 }, () => access.admit(tenantId, first.token)));
    assert.equal(parallel.filter((entry) => entry?.allowed).length, 10);
    const rotated = await access.issue(rateScope);
    assert.equal(await access.admit(tenantId, first.token), null);
    assert.equal((await access.admit(tenantId, rotated.token))?.allowed, false);
    const { rows: [hashed] } = await pool.query<{ token_digest: Buffer }>(
      "SELECT token_digest FROM workspace_mcp_access WHERE tenant_id=$1 AND user_id=$2", [tenantId, rateUserId]
    );
    await assert.rejects(accessRepository.save({ tenantId, userId: otherUserId, digest: hashed!.token_digest }), { code: "23505" });

    const capped = await access.issue(rateScope);
    async function resetMinute() {
      await pool.query(
        "UPDATE workspace_mcp_access SET window_started_at=clock_timestamp()-interval '2 minutes',window_calls=0 WHERE tenant_id=$1 AND user_id=$2",
        [tenantId, rateUserId]
      );
    }
    for (let batch = 0; batch < 4; batch++) {
      await resetMinute();
      const calls = await Promise.all(Array.from({ length: 10 }, () => access.admit(tenantId, capped.token)));
      assert.ok(calls.every((entry) => entry?.allowed));
    }
    await resetMinute();
    assert.equal((await access.admit(tenantId, capped.token))?.allowed, false);
    await access.revoke(rateScope);
    assert.equal(await access.admit(tenantId, capped.token), null);
    const expired = await access.issue(rateScope);
    await pool.query(
      "UPDATE workspace_mcp_access SET expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND user_id=$2",
      [tenantId, rateUserId]
    );
    assert.equal(await access.admit(tenantId, expired.token), null);
    const removed = await access.issue(rateScope);
    await pool.query("DELETE FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2", [tenantId, rateUserId]);
    assert.equal(await access.admit(tenantId, removed.token), null);
    const { rows } = await pool.query(
      "SELECT relrowsecurity AS rls, has_table_privilege('anon','workspace_mcp_access','SELECT') AS anon, has_table_privilege('authenticated','workspace_mcp_access','SELECT') AS authenticated FROM pg_class WHERE oid='workspace_mcp_access'::regclass"
    );
    assert.deepEqual(rows, [{ rls: true, anon: false, authenticated: false }]);
  });

  await t.test("a real MCP client reads tools, audits calls and responds to role revocation", async () => {
    const credential = await access.issue(scope);
    const audit = new PgAuditEventRepository(pool);
    registerWorkspaceMcpRoutes(api, {
      controls: new PgMcpControls(pool, { callsPerMinute: 10, callsPerDay: 400, providerCallsPerDay: 100, inputTokensPerDay: 100000,
        userCostNanoUsdPerDay: 10000000, tenantCostNanoUsdPerDay: 50000000, concurrentProviders: 2 }),
      access, tools: new McpReadTools(reads, { execute: (input) => reads.search(input.tenantId, input.query, input.limit, input.signal) }), audit: audit.record.bind(audit), shutdown: shutdown.signal,
      authorize: async () => ({ ok: false, status: 401, error: "The fixture exercises tool credentials." })
    });
    await api.listen({ host: "127.0.0.1", port: 0 });
    const bound = api.server.address();
    assert.ok(bound && typeof bound !== "string");
    await client.connect(new StdioClientTransport({
      command: "/bin/sh",
      args: [join(root, "scripts/start-workspace-mcp.sh")],
      env: { LUMORA_MCP_API_URL: "http://127.0.0.1:" + bound.port, LUMORA_MCP_TOKEN: credential.token,
        LUMORA_MCP_WORKSPACE_ID: tenantId, PATH: dirname(process.execPath) + delimiter + process.env.PATH }
    }));
    assert.equal((await client.listTools()).tools.length, 5);
    const sources = await client.callTool({ name: "list_sources", arguments: {} });
    assert.equal(mcpReadToolOutputSchemas.list_sources.parse(sources.structuredContent).sources[0]?.id, documentId);
    const search = await client.callTool({ name: "search_workspace", arguments: { query: "policy" } });
    assert.match(mcpReadToolOutputSchemas.search_workspace.parse(search.structuredContent).results[0]!.excerpt, /REDACTED_EMAIL/);
    const document = await client.callTool({ name: "get_document", arguments: { documentId } });
    assert.equal(mcpReadToolOutputSchemas.get_document.parse(document.structuredContent).passages.length, 1);
    const ingestion = await client.callTool({ name: "get_ingestion_status", arguments: { jobId: job!.id } });
    assert.equal(mcpReadToolOutputSchemas.get_ingestion_status.parse(ingestion.structuredContent).job?.status, "completed");
    const reports = await client.callTool({ name: "get_quality_report", arguments: {} });
    assert.equal(mcpReadToolOutputSchemas.get_quality_report.parse(reports.structuredContent).runs.length, 1);
    const { rows: logs } = await pool.query<{ action: string; metadata: { outcome: string } }>(
      "SELECT action,metadata FROM audit_events WHERE tenant_id=$1 ORDER BY created_at", [tenantId]
    );
    assert.equal(logs.length, 5);
    assert.ok(logs.every((row) => row.action === "mcp.tool_called" && row.metadata.outcome === "completed"));
    assert.ok(!JSON.stringify(logs).includes("support@example.com"));

    await pool.query("UPDATE tenant_memberships SET role='viewer' WHERE tenant_id=$1 AND user_id=$2", [tenantId, userId]);
    const denied = await client.callTool({ name: "get_quality_report", arguments: {} });
    assert.equal(denied.isError, true);
    assert.match(JSON.stringify(denied), /role does not permit/);

    lock = await pool.connect();
    await lock.query("BEGIN");
    await lock.query("LOCK TABLE public.documents IN ACCESS EXCLUSIVE MODE");
    const controller = new AbortController();
    const cancelled = assert.rejects(client.callTool({
      name: "search_workspace", arguments: { query: "policy" }
    }, { signal: controller.signal }));
    let waiting = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const { rows: [state] } = await pool.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [readApplication]
      );
      if (state!.count > 0) { waiting = true; break; }
      await wait(20);
    }
    assert.ok(waiting, "The read must reach the database before the client cancels it.");
    controller.abort();
    await cancelled;
    let audited = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const { rows: [state] } = await pool.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM audit_events WHERE tenant_id=$1 AND metadata->>'outcome'='tool_cancelled'", [tenantId]
      );
      if (state!.count > 0) { audited = true; break; }
      await wait(20);
    }
    assert.ok(audited, "Cancellation must reach the API's audited tool boundary.");
    await wait(2_100);
    const { rows: [residual] } = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND state='active'", [readApplication]
    );
    assert.equal(residual!.count, 0);
    await lock.query("ROLLBACK");
    lock.release();
    lock = undefined;

    await access.revoke(scope);
    const revoked = await client.callTool({ name: "list_sources", arguments: {} });
    assert.equal(revoked.isError, true);
    assert.match(JSON.stringify(revoked), /invalid or expired/);
  });
});
