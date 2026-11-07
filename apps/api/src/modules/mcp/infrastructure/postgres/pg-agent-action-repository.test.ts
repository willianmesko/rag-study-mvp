import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { AgentActionError, AgentActionService } from "../../application/agent-actions/agent-action-service.js";
import { LexicalEvaluationAction } from "../../application/agent-actions/lexical-evaluation-action.js";
import { PgAgentActionRepository } from "./pg-agent-action-repository.js";

const databaseUrl = process.env.AGENT_ACTION_TEST_DATABASE_URL;
const idempotencyKey = "agent_action_test_key";
const input = { action: "run_evaluation" };

test("the PostgreSQL action queue fences approval, retries, writes and replay", { skip: !databaseUrl }, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl!).hostname), "Use a disposable local database.");
  const schema = `agent_action_test_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString: databaseUrl });
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` });
  t.after(async () => {
    await pool.end();
    try { await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await adminPool.end(); }
  });
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`
    CREATE TABLE tenants (id UUID PRIMARY KEY);
    CREATE TABLE tenant_memberships (
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (tenant_id, user_id)
    );`);
  for (const filename of ["015_evaluation_runs.sql", "024_agent_actions.sql"]) {
    await pool.query(await readFile(new URL(`../../../../../db/migrations/${filename}`, import.meta.url), "utf8"));
  }

  const repository = new PgAgentActionRepository(pool);
  const service = new AgentActionService(repository);
  const emptyEvaluation = new LexicalEvaluationAction({ async search() { return []; } });
  const report = (tenantId: string) => emptyEvaluation.prepare(tenantId, new AbortController().signal);
  const countEvaluations = async (tenantId: string) =>
    Number((await pool.query("SELECT COUNT(*) FROM evaluation_runs WHERE tenant_id = $1", [tenantId])).rows[0].count);

  async function workspace() {
    const scope = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" as const };
    await pool.query("INSERT INTO tenants (id) VALUES ($1)", [scope.tenantId]);
    await pool.query("INSERT INTO tenant_memberships VALUES ($1, $2, 'owner')", [scope.tenantId, scope.userId]);
    return scope;
  }

  await t.test("concurrent proposals and workers converge on one approved result", async () => {
    const scope = await workspace();
    const other = await workspace();
    const [left, right] = await Promise.all([
      service.request({ ...scope, idempotencyKey, input }),
      service.request({ ...scope, idempotencyKey, input })
    ]);
    assert.equal(left.id, right.id);
    assert.equal(left.status, "pending_approval");
    assert.equal(await repository.claim(15_000), null);
    await assert.rejects(service.get({ ...other, actionId: left.id }), (error) =>
      error instanceof AgentActionError && error.code === "not_found");
    await assert.rejects(service.request({ ...scope, idempotencyKey: "different_valid_key", input }), (error) =>
      error instanceof AgentActionError && error.code === "conflict");
    const queued = await service.approve({ ...scope, actionId: left.id });
    assert.equal(queued.status, "queued");
    assert.equal((await service.approve({ ...scope, actionId: left.id })).events.length, 2);
    const leases = (await Promise.all([repository.claim(15_000), repository.claim(15_000)])).filter((lease) => lease !== null);
    assert.equal(leases.length, 1);
    const lease = leases[0]!;
    const evaluation = await report(scope.tenantId);
    await assert.rejects(repository.complete(lease, { ...evaluation, hitRate: 2 }));
    assert.equal(await countEvaluations(scope.tenantId), 0);
    assert.equal((await service.get({ ...scope, actionId: left.id })).status, "running");

    await Promise.all([repository.complete(lease, evaluation), repository.complete(lease, evaluation)]);
    const completed = await service.get({ ...scope, actionId: left.id });
    assert.equal(completed.status, "succeeded");
    assert.ok(completed.evaluationRunId);
    assert.equal(await countEvaluations(scope.tenantId), 1);
    assert.deepEqual(completed.events.map(({ reason }) => reason), ["requested", "approved", "started", "completed"]);
  });

  await t.test("revoked approvers cannot commit even after a claim", async () => {
    const scope = await workspace();
    const approver = { ...scope, userId: randomUUID() };
    await pool.query("INSERT INTO tenant_memberships VALUES ($1, $2, 'owner')", [approver.tenantId, approver.userId]);
    const action = await service.request({ ...scope, idempotencyKey, input });
    await service.approve({ ...approver, actionId: action.id });
    const lease = await repository.claim(15_000);
    assert.ok(lease);
    await pool.query("UPDATE tenant_memberships SET role = 'editor' WHERE tenant_id = $1 AND user_id = $2", [approver.tenantId, approver.userId]);
    await assert.rejects(service.get({ ...approver, actionId: action.id }), (error) =>
      error instanceof AgentActionError && error.code === "forbidden");
    await repository.complete(lease, await report(scope.tenantId));
    const stopped = await service.get({ ...scope, actionId: action.id });
    assert.equal(stopped.status, "dead_letter");
    assert.equal(stopped.events.at(-1)?.reason, "owner_revoked");
    assert.equal(await countEvaluations(scope.tenantId), 0);
  });

  await t.test("expired leases cannot write and repeated failures enter dead letter", async () => {
    const scope = await workspace();
    const action = await service.request({ ...scope, idempotencyKey, input });
    await service.approve({ ...scope, actionId: action.id });
    const stale = await repository.claim(15_000);
    assert.ok(stale);
    await pool.query("UPDATE agent_actions SET lease_until = clock_timestamp() - INTERVAL '1 second' WHERE id = $1", [action.id]);
    await repository.complete(stale, await report(scope.tenantId));
    assert.equal(await countEvaluations(scope.tenantId), 0);
    assert.equal(await repository.claim(15_000), null);
    assert.equal((await service.get({ ...scope, actionId: action.id })).events.at(-1)?.reason, "lease_expired");

    for (const expected of [2, 3]) {
      assert.equal(await repository.claim(15_000), null);
      await pool.query("UPDATE agent_actions SET ready_at = clock_timestamp() - INTERVAL '1 second' WHERE id = $1", [action.id]);
      const lease = await repository.claim(15_000);
      assert.ok(lease);
      assert.equal(lease.attempt, expected);
      await repository.fail(lease, "read_failed");
    }
    const dead = await service.get({ ...scope, actionId: action.id });
    assert.equal(dead.status, "dead_letter");
    assert.equal(dead.attempts, 3);
    assert.equal(dead.events.at(-1)?.reason, "read_failed");
    assert.equal(await repository.claim(15_000), null);
  });

  await t.test("unapproved requests expire and can be replaced without inheriting approval", async () => {
    const scope = await workspace();
    const old = await service.request({ ...scope, idempotencyKey, input });
    await pool.query("UPDATE agent_actions SET expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = $1", [old.id]);
    const fresh = await service.request({ ...scope, idempotencyKey: "another_approval_key", input });
    assert.equal(fresh.status, "pending_approval");
    assert.notEqual(fresh.id, old.id);
    const expired = await service.get({ ...scope, actionId: old.id });
    assert.equal(expired.status, "dead_letter");
    assert.equal(expired.events.at(-1)?.reason, "approval_expired");
    assert.equal(await repository.claim(15_000), null);
    await pool.query("UPDATE agent_actions SET expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = $1", [fresh.id]);
    assert.equal(await repository.claim(15_000), null);
  });

  await t.test("the rolling workspace approval budget persists across repository instances", async () => {
    const scope = await workspace();
    for (let run = 0; run < 2; run++) {
      const action = await service.request({ ...scope, idempotencyKey: `approved_action_${run}`, input });
      await service.approve({ ...scope, actionId: action.id });
      const lease = await repository.claim(15_000);
      assert.ok(lease);
      await repository.complete(lease, await report(scope.tenantId));
    }
    const action = await service.request({ ...scope, idempotencyKey: "approved_action_2", input });
    await assert.rejects(new AgentActionService(new PgAgentActionRepository(pool)).approve({ ...scope, actionId: action.id }), (error) =>
      error instanceof AgentActionError && error.code === "rate_limited");
    assert.equal((await service.get({ ...scope, actionId: action.id })).status, "pending_approval");
  });
});
