import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { parseRuntimeConfiguration } from "../../../../app/configuration/environment.js";
import { createNestHttpServer } from "../../../../app/nest/bootstrap.js";
import { PrismaPersistence } from "../../../../app/nest/persistence.module.js";
import { AUDIT_EVENTS } from "../../../../app/nest/tokens.js";
import type { AuditEventRepository } from "../../application/ports/audit-event-repository.js";
import { PgAuditEventRepository } from "../postgres/pg-audit-event-repository.js";
import { PrismaAuditEventRepository } from "./prisma-audit-event-repository.js";

const databaseUrl = process.env.PRISMA_PILOT_DATABASE_URL;

test("Prisma audit persistence preserves SQL records, Nest RBAC, concurrent appends, failures and RLS", async (t) => {
  assert.ok(databaseUrl, "The audit integration requires the disposable migrated Prisma database.");
  const config = parseRuntimeConfiguration({ DATABASE_URL: databaseUrl,
    SUPABASE_URL: "https://prisma-audit.example.test", SUPABASE_PUBLISHABLE_KEY: "fixture-publishable" });
  const actor = randomUUID(), stranger = randomUUID(), first = randomUUID(), second = randomUUID();
  let userId = actor;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    assert.equal(String(input), "https://prisma-audit.example.test/auth/v1/user", "No provider call is allowed.");
    return Response.json({ id: userId, aud: "authenticated", role: "authenticated" });
  });
  const runtime = await createNestHttpServer(config, { isProduction: true });
  const persistence = runtime.nest.get(PrismaPersistence, { strict: false });
  const repository = runtime.nest.get<PrismaAuditEventRepository>(AUDIT_EVENTS, { strict: false });
  assert.ok(repository instanceof PrismaAuditEventRepository);
  const pool = persistence.pool;
  assert.equal(pool.options.max, 2, "Audit reuses the existing bounded Prisma pool.");
  const constraint = `audit_test_${first.replaceAll("-", "")}`;
  t.after(async () => {
    try {
      await pool.query(`ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS ${constraint}`);
      await pool.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[first, second]]);
    } finally { await runtime.fastify.close(); await runtime.nest.close(); }
    assert.equal(pool.totalCount, 0);
  });
  await pool.query("INSERT INTO tenants(id,name,slug) VALUES ($1,'Audit A',$2),($3,'Audit B',$4)", [first, `audit-${first}`, second, `audit-${second}`]);
  await pool.query("INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES ($1,$2,'owner'),($3,$2,'viewer')", [first, actor, second]);
  const input: Parameters<AuditEventRepository["record"]>[0] = { tenantId: first, actorUserId: null,
    action: "conversation.feedback", resourceType: "conversation", resourceId: null, requestId: "audit-compatibility",
    metadata: { text: "safe fixture ' quote — 日本語", flag: false, amount: 0, absent: null, nonFinite: Number.NaN } };
  const legacy = new PgAuditEventRepository(pool);
  await legacy.record(input);
  await repository.record(input);
  const equivalent = await pool.query("SELECT actor_user_id,action,resource_type,resource_id,request_id,metadata FROM audit_events WHERE tenant_id=$1 ORDER BY created_at,id", [first]);
  assert.equal(equivalent.rowCount, 2);
  assert.deepEqual(equivalent.rows[0], equivalent.rows[1], "Prisma and legacy SQL persist the same JSON/null/Unicode values.");
  const defaults = await pool.query("SELECT id,created_at,now() AS database_now FROM audit_events WHERE tenant_id=$1", [first]);
  assert.notEqual(defaults.rows[0].id, defaults.rows[1].id, "Each append retains its own database-generated identity.");
  assert.ok(defaults.rows.every(row => Math.abs(row.created_at.getTime() - row.database_now.getTime()) < 10_000));
  await Promise.all(Array.from({ length: 40 }, (_, i) => repository.record({ ...input,
    tenantId: i % 2 ? second : first, requestId: `parallel-${i}` })));
  const parallel = await pool.query("SELECT tenant_id,count(*)::int AS n FROM audit_events WHERE tenant_id=ANY($1::uuid[]) AND request_id LIKE 'parallel-%' GROUP BY tenant_id", [[first, second]]);
  assert.deepEqual(parallel.rows.map(row => row.n).sort(), [20, 20], "Concurrent appends cannot overwrite or cross-bind workspaces.");
  const policy = { allowedModelIds: ["default"], defaultModelId: "default", auto: null };
  const headers = { authorization: "Bearer fixture", "x-workspace-id": first };
  const write = (workspace = first) => runtime.fastify.inject({ method: "PATCH", url: "/v1/admin/chat-model-policy", headers: { ...headers, "x-workspace-id": workspace }, payload: policy });
  assert.equal((await write()).statusCode, 200);
  const conversation = await runtime.fastify.inject({ method: "POST", url: "/v1/conversations", headers,
    payload: { id: randomUUID(), title: "Synthetic audit conversation" } });
  assert.equal(conversation.statusCode, 201);
  const conversationId = conversation.json().conversation.id;
  const conversationAudit = await pool.query("SELECT resource_id FROM audit_events WHERE tenant_id=$1 AND action='conversation.created'", [first]);
  assert.deepEqual(conversationAudit.rows.map(row => row.resource_id), [conversationId]);
  const ownerAudit = await pool.query("SELECT tenant_id,actor_user_id,action,resource_type,metadata FROM audit_events WHERE tenant_id=$1 AND action='chat.model_policy_updated'", [first]);
  assert.equal(ownerAudit.rowCount, 1, "The real Nest handler uses the Prisma audit port.");
  assert.equal(ownerAudit.rows[0].actor_user_id, actor);
  assert.ok(!JSON.stringify(ownerAudit.rows[0].metadata).includes("Bearer"));
  assert.equal((await write(second)).statusCode, 403);
  userId = stranger;
  assert.equal((await write()).statusCode, 403);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE tenant_id=$1 AND action='chat.model_policy_updated'", [first])).rows[0].n, 1);
  userId = actor;
  // Fault injection is local-only and scoped to this test's actor; other suites keep working.
  await pool.query(`ALTER TABLE audit_events ADD CONSTRAINT ${constraint} CHECK(actor_user_id IS DISTINCT FROM '${actor}'::uuid) NOT VALID`);
  const failed = await write();
  assert.equal(failed.statusCode, 500, "A failed audit cannot become an apparently successful HTTP result.");
  assert.ok(!failed.payload.includes(constraint) && !failed.payload.includes("Prisma") && !failed.payload.includes(actor));
  await pool.query(`ALTER TABLE audit_events DROP CONSTRAINT ${constraint}`);
  await assert.rejects(repository.record({ ...input, tenantId: randomUUID() }), "The existing tenant FK must reject orphan audit records.");
  const rls = await pool.query("SELECT relrowsecurity FROM pg_class WHERE oid='audit_events'::regclass");
  assert.equal(rls.rows[0].relrowsecurity, true);
  const restrictedPool = new Pool({ connectionString: databaseUrl, max: 1, options: "-c role=authenticated" });
  const restrictedClient = new PrismaClient({ adapter: new PrismaPg(restrictedPool), log: [] });
  try {
    const role = await restrictedClient.$queryRaw<Array<{ role: string }>>`SELECT current_user AS role`;
    assert.equal(role[0]?.role, "authenticated", "The denial must use a live restricted-role connection.");
    await assert.rejects(new PrismaAuditEventRepository(restrictedClient).record({ ...input, requestId: "forbidden-public-write" }));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE request_id='forbidden-public-write'")).rows[0].n, 0);
  } finally { await restrictedClient.$disconnect(); await restrictedPool.end(); }
});
