import assert from "node:assert/strict";
import test from "node:test";
import { McpHybridSearch, McpBudgetExceededError, McpIndexUnavailableError, type McpHybridReadRepository, type McpProviderBudget } from "./hybrid-search.js";
import type { EmbeddingModelIdentity } from "../../ai/application/ports/workspace-embedding-index.js";

const identity: EmbeddingModelIdentity = { provider: "openrouter", model: "priced-fixture", dimensions: 1024 };
const input = { tenantId: "tenant", userId: "user", query: "the policy support@example.com", limit: 5, signal: new AbortController().signal };
function fixture(options: { noIndex?: boolean; denied?: boolean; provider?: (query: string, signal?: AbortSignal) => Promise<number[]>; maxCost?: number } = {}) {
  const calls: { reservations: number; finished: number; providers: number; hybrid: number } = { reservations: 0, finished: 0, providers: 0, hybrid: 0 };
  const reads: McpHybridReadRepository = {
    activeIndex: async () => options.noIndex ? null : { ...identity, revision: "version" },
    hybrid: async (search) => { calls.hybrid++; assert.equal(search.tenantId, input.tenantId); assert.equal(search.revision, "version"); return []; }
  };
  const budgets: McpProviderBudget = {
    reserve: async (reservation) => { calls.reservations++; assert.equal(reservation.userId, input.userId); assert.equal(reservation.costNanoUsd, reservation.inputTokens * 1000); return options.denied ? null : "reservation"; },
    finishReservation: async () => { calls.finished++; }
  };
  const service = new McpHybridSearch(reads, budgets, () => ({ embed: async (query, type, signal) => {
    calls.providers++; assert.equal(type, "query"); assert.ok(!query.includes("support@example.com"));
    return options.provider ? options.provider(query, signal) : [1, ...Array(1023).fill(0)];
  } }), [{ ...identity, inputCostPer1kUsd: 0.001 }], { maxInputTokens: 2048, maxCostNanoUsd: options.maxCost ?? 5_000_000 });
  return { service, calls };
}
test("MCP hybrid search reserves a conservative priced budget before one redacted query embedding", async () => {
  const { service, calls } = fixture(); await service.execute(input);
  assert.deepEqual(calls, { reservations: 1, providers: 1, hybrid: 1, finished: 1 });
});
test("MCP refuses an unavailable index or exhausted provider budget without a provider call", async () => {
  for (const options of [{ noIndex: true }, { denied: true }, { maxCost: 0 }]) {
    const { service, calls } = fixture(options);
    await assert.rejects(service.execute(input), options.noIndex ? McpIndexUnavailableError : McpBudgetExceededError);
    assert.equal(calls.providers, 0); assert.equal(calls.hybrid, 0);
  }
});
test("MCP provider failures retain accounting and release only the concurrent reservation", async () => {
  const { service, calls } = fixture({ provider: async () => { throw new Error("provider failed"); } });
  await assert.rejects(service.execute(input)); assert.equal(calls.finished, 1); assert.equal(calls.hybrid, 0);
});
test("MCP cancellation reaches the provider and stops retrieval even if the adapter ignores abort", async () => {
  const controller = new AbortController(); let observed: AbortSignal | undefined;
  const { service, calls } = fixture({ provider: async (_query, signal) => { observed = signal; controller.abort(); return new Promise(() => {}); } });
  await assert.rejects(service.execute({ ...input, signal: controller.signal }));
  assert.equal(observed?.aborted, true); assert.equal(calls.hybrid, 0); assert.equal(calls.finished, 1);
});
test("MCP does not call providers for a query containing only PII or an already-cancelled request", async () => {
  const { service, calls } = fixture();
  assert.deepEqual(await service.execute({ ...input, query: "support@example.com" }), []);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(service.execute({ ...input, signal: controller.signal }));
  assert.equal(calls.reservations, 0); assert.equal(calls.providers, 0);
});
