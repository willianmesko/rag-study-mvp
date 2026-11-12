import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { parseRuntimeConfiguration } from "../../../../app/configuration/environment.js";
import { createNestHttpServer } from "../../../../app/nest/bootstrap.js";
import { PrismaPersistence } from "../../../../app/nest/persistence.module.js";
import { WORKSPACE_MODEL_POLICIES } from "../../../../app/nest/tokens.js";
import { PrismaWorkspaceModelPolicyRepository } from "./prisma-workspace-model-policy-repository.js";
import { PgWorkspaceModelPolicyRepository } from "../postgres/pg-workspace-model-policy-repository.js";
import { StoredRecordError } from "../../../../platform/database/stored-record.js";

// This integration command is a required gate, not a silently skipped unit case.
const databaseUrl = process.env.PRISMA_PILOT_DATABASE_URL;
test("Nest DI uses Prisma against the existing SQL schema, preserves RBAC and isolates workspace policies", async (t) => {
  assert.ok(databaseUrl, "Set PRISMA_PILOT_DATABASE_URL to a migrated disposable local prisma_pilot_* database.");
  const url = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && /^\/prisma_pilot_[a-z0-9_]+$/i.test(url.pathname));
  const config = parseRuntimeConfiguration({ DATABASE_URL: databaseUrl, SUPABASE_URL: "https://prisma-auth.example.test", SUPABASE_PUBLISHABLE_KEY: "fixture-publishable" });
  const actor = randomUUID(), first = randomUUID(), second = randomUUID(), stranger = randomUUID();
  let userId = actor;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    assert.equal(String(input), "https://prisma-auth.example.test/auth/v1/user");
    return Response.json({ id: userId, aud: "authenticated", role: "authenticated" });
  });
  const runtime = await createNestHttpServer(config, { isProduction: true });
  const persistence = runtime.nest.get(PrismaPersistence, { strict: false });
  const repository = runtime.nest.get<PrismaWorkspaceModelPolicyRepository>(WORKSPACE_MODEL_POLICIES, { strict: false });
  assert.ok(repository instanceof PrismaWorkspaceModelPolicyRepository);
  assert.equal(runtime.application!.useCases.workspaceModelPolicies, repository);
  const pool = persistence.pool;
  t.after(async () => {
    try { await pool.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[first, second]]); }
    finally { await runtime.fastify.close(); await runtime.nest.close(); }
    assert.equal(pool.totalCount, 0, "Nest must dispose the pilot pool.");
  });
  await pool.query("INSERT INTO tenants(id,name,slug) VALUES ($1,'First',$2),($3,'Second',$4)", [first, `prisma-${first}`, second, `prisma-${second}`]);
  await pool.query("INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES ($1,$2,'owner'),($3,$2,'viewer')", [first, actor, second]);
  const policy = { allowedModelIds: ["default"], defaultModelId: "default", auto: null };
  assert.equal(await repository.get(first), null);
  assert.deepEqual(await repository.save(first, policy), policy);
  assert.equal(await repository.get(second), null);
  const legacy = new PgWorkspaceModelPolicyRepository(pool);
  assert.deepEqual(await legacy.get(first), policy, "SQL rollback can read Prisma writes.");
  await legacy.save(second, policy);
  assert.deepEqual(await repository.get(second), policy, "Prisma can read existing SQL writes.");
  const headers = { authorization: "Bearer fixture", "x-workspace-id": first };
  const response = await runtime.fastify.inject({ method: "PATCH", url: "/v1/admin/chat-model-policy", headers, payload: policy });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().policy, policy);
  assert.equal((await runtime.fastify.inject({ method: "PATCH", url: "/v1/admin/chat-model-policy", headers: { ...headers, "x-workspace-id": second }, payload: policy })).statusCode, 403);
  assert.equal((await runtime.fastify.inject({ method: "PATCH", url: "/v1/admin/chat-model-policy", headers, payload: { ...policy, allowedModelIds: ["arbitrary-model"], defaultModelId: "arbitrary-model" } })).statusCode, 400);
  userId = stranger;
  assert.equal((await runtime.fastify.inject({ url: "/v1/admin/chat-model-policy", headers })).statusCode, 403);
  await pool.query("UPDATE workspace_chat_model_policies SET policy = '{\"private\":\"sentinel\"}'::jsonb WHERE tenant_id=$1", [first]);
  await assert.rejects(repository.get(first), StoredRecordError);
  const rls = await pool.query("SELECT relrowsecurity FROM pg_class WHERE oid='workspace_chat_model_policies'::regclass");
  assert.equal(rls.rows[0].relrowsecurity, true);
});
