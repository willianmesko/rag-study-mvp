import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { emptyCheckpoint } from "@langchain/langgraph";
import { Pool } from "pg";
import type { RerankInput, Reranker } from "../../application/ports/reranker.js";
import { planRerankerReservation } from "../../application/policies/reranker-budget.js";
import { withExecution, workflowEffect } from "../../../../platform/workflows/execution-context.js";
import { WorkflowUsageOverrunError, type WorkflowLease } from "../../../../platform/workflows/types.js";
import { WorkflowStateCodec } from "../../../../platform/workflows/workflow-state-codec.js";
import { WorkflowReranker } from "../security/workflow-provider-guards.js";
import { ProviderMeasurements } from "../../../usage/infrastructure/observability/measured-providers.js";
import { PgWorkflowCheckpointer } from "../../../../platform/workflows/pg-workflow-checkpointer.js";
import { PgWorkflowRepository } from "../../../../platform/workflows/pg-workflow-repository.js";
import { PgUsageMetricsRepository } from "../../../usage/infrastructure/postgres/pg-usage-metrics-repository.js";
import { PgChatRunRepository } from "../../../chat/infrastructure/postgres/pg-chat-run-repository.js";

const databaseUrl = process.env.MCP_TEST_DATABASE_URL;
const billing = { billing: "paid", provider: "jina", model: "fixture-reranker", inputCostPer1kUsd: 0.0001 } as const;
const budget = { maxSteps: 40, maxCalls: 10, maxInputTokens: 1000000, maxOutputTokens: 0, maxCostMicros: 1000000, timeoutMs: 60000 };
const input = (): RerankInput => ({ query: "Fixture question", limit: 1, candidates: [{
  chunkId: "chunk", documentId: "document", ordinal: 0, content: "PRIVATE_PASSAGE_SENTINEL", source: "fixture", title: null, score: 0.9,
  security: { promptInjectionRisk: "low", signals: [] },
}] });

test("paid-reranker reservations and verified overruns remain fenced across database restart contexts", { skip: !databaseUrl, timeout: 30000 }, async (t) => {
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl!).hostname), "Use a disposable local database.");
  const schema = `reranker_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, max: 5, options: `-c search_path=${schema},public` });
  t.after(async () => {
    await pool.end();
    try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await admin.end(); }
  });
  for (const table of ["tenants", "tenant_memberships", "workflow_runs", "workflow_effects", "workflow_checkpoints", "workflow_writes", "workflow_events", "ai_usage_events", "chat_runs", "chat_run_events"]) {
    await admin.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  const codec = new WorkflowStateCodec(randomBytes(32).toString("base64"));
  const repo = new PgWorkflowRepository(pool, codec), ledger = new PgUsageMetricsRepository(pool), chats = new PgChatRunRepository(pool);
  const admit = async (kind: "chat" | "evaluation", maxCostMicros = budget.maxCostMicros) => {
    const scope = { tenantId: randomUUID(), actorId: randomUUID(), runId: randomUUID() };
    await pool.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Reranker fixture')", [scope.tenantId, `reranker-${scope.tenantId}`]);
    await pool.query("INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [scope.tenantId, scope.actorId]);
    await repo.admit({ ...scope, kind, version: "fixture-v1", budget: { ...budget, maxCostMicros }, input: {} });
    const lease = await repo.claim([kind]);
    assert.ok(lease && lease.runId === scope.runId);
    return lease;
  };
  const run = <T>(lease: WorkflowLease, repository: PgWorkflowRepository, work: () => Promise<T>) => withExecution({
    lease, repository, signal: new AbortController().signal, authorize: async () => true,
    node: "rerank-fixture", effects: new Map(), publications: { next: 0 },
  }, work);

  await t.test("replaying a committed receipt does not reserve, invoke or record charges twice", async () => {
    const lease = await admit("evaluation");
    let calls = 0;
    const measured = new ProviderMeasurements(ledger);
    const inner = measured.reranker({ enabled: true, rerank: async ({ onUsage, candidates }) => {
      calls++;
      onUsage?.({ inputTokens: 10, outputTokens: 0, costUsd: 0.000001 });
      return candidates;
    } }, { provider: billing.provider, model: billing.model, inputPrice: billing.inputCostPer1kUsd });
    const guarded = new WorkflowReranker(inner, billing);
    await run(lease, repo, () => guarded.rerank(input()));
    const first = await repo.get(lease);
    await run(lease, new PgWorkflowRepository(pool, codec), () => guarded.rerank(input()));
    const replayed = await repo.get(lease);
    assert.equal(calls, 1);
    assert.equal(first?.costMicros, planRerankerReservation(input(), billing).costMicros);
    assert.equal(replayed?.costMicros, first?.costMicros);
    assert.equal(replayed?.calls, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM ai_usage_events WHERE workflow_run_id=$1", [lease.runId])).rows[0].count, 1);
    await repo.finish(lease, "completed");
  });

  await t.test("ordinary pre-call budget denial leaves the run available for a safe fallback", async () => {
    const amount = planRerankerReservation(input(), billing);
    const lease = await admit("evaluation", amount.costMicros - 1);
    let calls = 0;
    const guarded = new WorkflowReranker({ enabled: true, rerank: async ({ candidates }) => { calls++; return candidates; } }, billing);
    await run(lease, repo, async () => {
      await assert.rejects(guarded.rerank(input()), /budget_exceeded/);
      assert.equal(await workflowEffect("safe-local-fallback", {}, {}, async () => "local result"), "local result");
    });
    assert.equal(calls, 0);
    assert.equal((await repo.get(lease))?.status, "running");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM ai_usage_events WHERE workflow_run_id=$1", [lease.runId])).rows[0].count, 0);
    await repo.finish(lease, "completed");
  });

  await t.test("actual ledger, failed effect, terminal run and linked error survive a fresh process scope", async () => {
    const lease = await admit("chat");
    let calls = 0, signal: AbortSignal | undefined;
    const amount = planRerankerReservation(input(), billing);
    const measured = new ProviderMeasurements({ record: async (record) => {
      assert.equal(signal?.aborted, false, "reported usage is saved before cancellation");
      await ledger.record(record);
    }, summarize: ledger.summarize.bind(ledger) });
    const inner = measured.reranker({ enabled: true, rerank: async (request) => {
      calls++;
      signal = request.signal;
      request.onUsage?.({ inputTokens: amount.inputTokens + 100, outputTokens: 0 });
      return request.candidates;
    } }, { provider: billing.provider, model: billing.model, inputPrice: billing.inputCostPer1kUsd });
    const guarded = new WorkflowReranker(inner, billing);
    await run(lease, repo, async () => {
      await assert.rejects(guarded.rerank(input()), WorkflowUsageOverrunError);
      assert.equal(signal?.aborted, true);
      await assert.rejects(workflowEffect("later-paid-call", {}, { calls: 1 }, async () => { calls++; }), /budget_exceeded/);
    });
    assert.equal(calls, 1);
    assert.equal((await repo.get(lease))?.status, "failed");
    assert.equal((await repo.get(lease))?.errorCode, "budget_exceeded");
    const receipt = (await pool.query("SELECT state,last_code,cipher FROM workflow_effects WHERE run_id=$1", [lease.runId])).rows[0];
    assert.deepEqual(receipt, { state: "permanent", last_code: "budget_exceeded", cipher: null });
    const usage = (await pool.query("SELECT input_tokens,observed_cost_usd,estimated_cost_usd,usage_source,pricing_known,failed FROM ai_usage_events WHERE workflow_run_id=$1", [lease.runId])).rows[0];
    assert.equal(usage.input_tokens, amount.inputTokens + 100);
    assert.equal(usage.observed_cost_usd, null, "native token counts do not manufacture a provider dollar quote");
    assert.equal(Number(usage.estimated_cost_usd), Number(((amount.inputTokens + 100) * billing.inputCostPer1kUsd / 1000).toFixed(8)));
    assert.equal(usage.usage_source, "observed");
    assert.equal(usage.pricing_known, true);
    assert.equal(usage.failed, true);
    const restarted = new PgWorkflowRepository(pool, codec);
    assert.equal(await restarted.claim(["chat"]), null);
    await run(lease, restarted, async () => {
      await assert.rejects(restarted.reserve(lease, { calls: 1 }), /lease_lost/);
      await assert.rejects(workflowEffect("fresh-context-paid-call", {}, { calls: 1 }, async () => { calls++; }), /lease_lost/);
      const saver = new PgWorkflowCheckpointer(restarted, lease, "fixture");
      await assert.rejects(saver.put({ configurable: { thread_id: saver.threadId } }, emptyCheckpoint(), { source: "update", step: 1, parents: {} }, {}), /lease_lost/);
      await assert.rejects(chats.append(lease, [{ type: "token", delta: "must not publish" }]), /lease_lost/);
      await assert.rejects(restarted.finish(lease, "completed"), /lease_lost/);
    });
    assert.equal(await new PgChatRunRepository(pool).append(lease, [{ type: "token", delta: "must not publish" }]), false);
    assert.equal((await chats.read(lease, 0))?.status, "failed");
    assert.deepEqual((await chats.read(lease, 0))?.events.map(({ event }) => event.type), ["accepted", "error"]);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM workflow_checkpoints WHERE run_id=$1", [lease.runId])).rows[0].count, 0);
    assert.equal(calls, 1);
  });

  await t.test("a failed terminal commit is classified ambiguous and cannot masquerade as durable cancellation", async () => {
    const lease = await admit("chat");
    await pool.query(`CREATE FUNCTION ${schema}.reject_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event->>'type'='error' THEN RAISE EXCEPTION 'fixture terminal failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER reject_terminal BEFORE INSERT ON ${schema}.chat_run_events FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_terminal()`);
    let calls = 0;
    const measured = new ProviderMeasurements(ledger);
    const inner: Reranker = measured.reranker({ enabled: true, rerank: async ({ onUsage, candidates }) => {
      calls++;
      onUsage?.({ inputTokens: 10, outputTokens: 0, costUsd: 0.025 });
      return candidates;
    } }, { provider: billing.provider, model: billing.model, inputPrice: billing.inputCostPer1kUsd });
    const guarded = new WorkflowReranker(inner, billing);
    await run(lease, repo, async () => {
      await assert.rejects(guarded.rerank(input()), /effect_outcome_unknown/);
      await assert.rejects(workflowEffect("after-unknown-commit", {}, { calls: 1 }, async () => { calls++; }), /effect_outcome_unknown/);
    });
    // The injected failure is after the receipt/run updates but before commit.
    // All terminal mutations roll back together; the actual ledger stays saved.
    assert.equal((await repo.get(lease))?.status, "running");
    assert.equal((await chats.read(lease, 0))?.status, "running");
    assert.equal((await pool.query("SELECT state FROM workflow_effects WHERE run_id=$1", [lease.runId])).rows[0].state, "started");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM ai_usage_events WHERE workflow_run_id=$1", [lease.runId])).rows[0].count, 1);
    await pool.query(`DROP TRIGGER reject_terminal ON ${schema}.chat_run_events`);
    await pool.query("UPDATE workflow_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1", [lease.runId]);
    const restarted = new PgWorkflowRepository(pool, codec), reclaimed = await restarted.claim(["chat"]);
    assert.ok(reclaimed);
    await run(reclaimed, restarted, () => assert.rejects(guarded.rerank(input()), /effect_outcome_unknown/));
    assert.equal(calls, 1, "an unresolved durable receipt never repeats the charged call");
    // After database recovery the normal runner can explicitly finish unknown
    // work as failed. The guard did not claim this earlier commit had succeeded.
    await restarted.finish(reclaimed, "failed", undefined, "effect_outcome_unknown");
  });
});
