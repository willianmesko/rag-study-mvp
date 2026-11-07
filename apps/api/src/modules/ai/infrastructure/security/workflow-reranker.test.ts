import assert from "node:assert/strict";
import test from "node:test";
import type { Reranker, RerankInput } from "../../application/ports/reranker.js";
import type { RetrievedChunk } from "../../../knowledge/domain/document.js";
import type { UsageMetricsRepository } from "../../../usage/application/ports/usage-metrics-repository.js";
import { planRerankerReservation, RerankerBudgetError, rerankerInputLimits } from "../../application/policies/reranker-budget.js";
import { withTransientBudget } from "../../../../platform/workflows/transient-budget.js";
import { workflowEffect } from "../../../../platform/workflows/execution-context.js";
import { WorkflowUsageOverrunError } from "../../../../platform/workflows/types.js";
import { withProviderUsageScope } from "../../../../platform/observability/provider-usage-context.js";
import { ProviderMeasurements } from "../../../usage/infrastructure/observability/measured-providers.js";
import { WorkflowReranker } from "./workflow-provider-guards.js";

const paid = { billing: "paid", provider: "jina", model: "fixture-reranker", inputCostPer1kUsd: 0.0001 } as const;
const budget = { maxSteps: 100, maxCalls: 10, maxInputTokens: 4_000_000, maxOutputTokens: 0, maxCostMicros: 100_000_000, timeoutMs: 60_000 };
const candidate = (content = "A grounded passage.", id = "chunk"): RetrievedChunk => ({
  chunkId: id, documentId: "document", ordinal: 0, content, source: "source", title: null, score: 0.9,
  security: { promptInjectionRisk: "low", signals: [] },
});
const request = (): RerankInput => ({ query: "Question", candidates: [candidate()], limit: 1 });

test("reranking reservation grows with document size, candidate count and approved price", () => {
  const small = planRerankerReservation(request(), paid);
  const large = planRerankerReservation({ ...request(), candidates: [candidate("x".repeat(2000))] }, paid);
  const many = planRerankerReservation({ ...request(), candidates: [candidate(), candidate("Another passage", "second")] }, paid);
  const dearer = planRerankerReservation(request(), { ...paid, inputCostPer1kUsd: paid.inputCostPer1kUsd * 2 });
  assert.ok(large.inputTokens > small.inputTokens);
  assert.ok(large.costMicros > small.costMicros);
  assert.ok(many.inputTokens > small.inputTokens);
  assert.ok(many.costMicros > small.costMicros);
  assert.ok(dearer.costMicros > small.costMicros);
  assert.ok(small.amount.calls === 1 && small.costMicros > 0);
  assert.notEqual(small.costMicros, 1000, "the previous fixed-price reservation is gone");
});

test("missing, zero and invalid paid prices are denied before provider invocation", async () => {
  let calls = 0;
  const inner: Reranker = { enabled: true, rerank: async ({ candidates }) => { calls++; return candidates; } };
  for (const policy of [undefined, { ...paid, inputCostPer1kUsd: undefined }, { ...paid, inputCostPer1kUsd: 0 },
    { ...paid, inputCostPer1kUsd: -1 }, { ...paid, inputCostPer1kUsd: Infinity }, { ...paid, inputCostPer1kUsd: NaN }]) {
    await assert.rejects(new WorkflowReranker(inner, policy).rerank(request()), (error) => error instanceof RerankerBudgetError && error.reason === "reranker_price_unavailable");
  }
  assert.equal(calls, 0);
});

test("bounded queries, individual passages, candidate counts and total payload fail before calls", async () => {
  let calls = 0;
  const guarded = new WorkflowReranker({ enabled: true, rerank: async ({ candidates }) => { calls++; return candidates; } }, paid);
  for (const input of [
    { ...request(), query: "x".repeat(rerankerInputLimits.maxQueryBytes + 1) },
    { ...request(), query: "漢".repeat(1366) },
    { ...request(), candidates: [candidate("x".repeat(rerankerInputLimits.maxCandidateBytes + 1))] },
    { ...request(), candidates: Array.from({ length: rerankerInputLimits.maxCandidates + 1 }, (_, index) => candidate("x", String(index))) },
    { ...request(), candidates: Array.from({ length: 100 }, (_, index) => candidate("x".repeat(4000), String(index))) },
    { ...request(), limit: 0 },
  ]) await assert.rejects(guarded.rerank(input), (error) => error instanceof RerankerBudgetError && error.reason === "reranker_input_limit");
  assert.equal(calls, 0);
});

test("stateless calls also obey the independent per-call cost ceiling", async () => {
  let calls = 0;
  const inner: Reranker = { enabled: true, rerank: async ({ candidates }) => { calls++; return candidates; } };
  await assert.rejects(new WorkflowReranker(inner, { ...paid, maxCostMicros: 0 }).rerank(request()), (error) => error instanceof RerankerBudgetError && error.reason === "reranker_cost_limit");
  assert.equal(calls, 0);
  assert.equal((await new WorkflowReranker(inner, paid).rerank(request())).length, 1);
  assert.equal(calls, 1);
});

test("transient budgets reject an unaffordable reservation and permit the exact boundary once", async () => {
  let calls = 0;
  const guarded = new WorkflowReranker({ enabled: true, rerank: async ({ candidates }) => { calls++; return candidates; } }, paid);
  const amount = planRerankerReservation(request(), paid);
  await assert.rejects(withTransientBudget({ ...budget, maxCostMicros: amount.costMicros - 1 }, () => guarded.rerank(request())), /budget_exceeded/);
  assert.equal(calls, 0);
  await withTransientBudget({ ...budget, maxCostMicros: amount.costMicros }, async () => {
    assert.equal((await guarded.rerank(request())).length, 1);
    await assert.rejects(guarded.rerank(request()), /budget_exceeded/);
  });
  assert.equal(calls, 1);
});

test("empty and disabled stages make no call; local invocations are bounded without API-token or cost billing", async () => {
  let calls = 0;
  const inner: Reranker = { enabled: false, rerank: async () => { calls++; throw new Error("No API call is expected."); } };
  assert.equal((await new WorkflowReranker(inner).rerank(request())).length, 1);
  assert.deepEqual(await new WorkflowReranker({ ...inner, enabled: true }).rerank({ ...request(), candidates: [] }), []);
  assert.equal(calls, 0);
  const local = new WorkflowReranker({ enabled: true, rerank: async ({ candidates }) => { calls++; return candidates; } }, { billing: "local" });
  await withTransientBudget({ ...budget, maxCostMicros: 0, maxInputTokens: 1, maxCalls: 2 }, async () => {
    await local.rerank(request());
    await local.rerank(request());
    await assert.rejects(local.rerank(request()), /budget_exceeded/);
  });
  assert.equal(calls, 2);
});

test("caller cancellation reaches the reranker without bypassing its reservation", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const guarded = new WorkflowReranker({ enabled: true, rerank: ({ signal }) => new Promise((_resolve, reject) => {
    assert.ok(signal);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    started();
  }) }, paid);
  const work = withTransientBudget(budget, () => guarded.rerank({ ...request(), signal: controller.signal }));
  await ready;
  const reason = new Error("Fixture cancelled.");
  controller.abort(reason);
  await assert.rejects(work, (error) => error === reason);
});

test("native overruns retain reported ledger values before stopping all later effects", async () => {
  const records: Parameters<UsageMetricsRepository["record"]>[0][] = [];
  let calls = 0, providerSignal: AbortSignal | undefined;
  const measured = new ProviderMeasurements({ record: async (record) => {
    assert.equal(providerSignal?.aborted, false, "accounting precedes the overrun abort");
    records.push(record);
  }, summarize: async () => assert.fail("unused") });
  const amount = planRerankerReservation(request(), paid);
  const inner = measured.reranker({ enabled: true, rerank: async ({ signal, onUsage, candidates }) => {
    calls++;
    providerSignal = signal;
    onUsage?.({ inputTokens: amount.inputTokens + 1, outputTokens: 0, costUsd: 0.025 });
    return candidates;
  } }, { provider: paid.provider, model: paid.model, inputPrice: paid.inputCostPer1kUsd });
  const guarded = new WorkflowReranker(inner, paid);
  await withProviderUsageScope({ tenantId: "workspace", actorKey: "actor" }, () => withTransientBudget(budget, async () => {
    await assert.rejects(guarded.rerank(request()), WorkflowUsageOverrunError);
    assert.equal(providerSignal?.aborted, true);
    await assert.rejects(workflowEffect("later-provider", {}, { calls: 1 }, async () => { calls++; }), /budget_exceeded/);
    await assert.rejects(guarded.rerank(request()), WorkflowUsageOverrunError);
  }));
  assert.equal(calls, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].inputTokens, amount.inputTokens + 1);
  assert.equal(records[0].observedCostUsd, 0.025);
  assert.equal(records[0].source, "observed");
  assert.equal(records[0].pricingKnown, true);
  assert.equal(records[0].failed, true);
  assert.ok(records[0].idempotencyKey);
  assert.doesNotMatch(JSON.stringify(records), /grounded passage|Question/);
});

test("reported zero charge remains observed zero rather than the conservative reservation", async () => {
  const records: Parameters<UsageMetricsRepository["record"]>[0][] = [];
  const measured = new ProviderMeasurements({ record: async (record) => { records.push(record); }, summarize: async () => assert.fail("unused") });
  const inner = measured.reranker({ enabled: true, rerank: async ({ onUsage, candidates }) => {
    onUsage?.({ inputTokens: 5, outputTokens: 0, costUsd: 0 });
    return candidates;
  } }, { provider: paid.provider, model: paid.model, inputPrice: paid.inputCostPer1kUsd });
  await withProviderUsageScope({ tenantId: "workspace", actorKey: "actor" }, () => new WorkflowReranker(inner, paid).rerank(request()));
  assert.equal(records[0].observedCostUsd, 0);
  assert.equal(records[0].source, "observed");
  assert.equal(records[0].failed, false);
});
