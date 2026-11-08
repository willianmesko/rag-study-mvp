import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { PgWorkflowRepository } from "./pg-workflow-repository.js";
import { WorkflowStateCodec } from "./workflow-state-codec.js";
import { StoredRecordError } from "../database/stored-record.js";

const scope = { tenantId: "20000000-0000-4000-8000-000000000001", actorId: "10000000-0000-4000-8000-000000000001", runId: "30000000-0000-4000-8000-000000000001" };
const budget = { maxSteps: 8, maxCalls: 4, maxInputTokens: 1000, maxOutputTokens: 0, maxCostMicros: 0, timeoutMs: 30000 };
const row = (storedBudget: unknown = budget) => ({ tenant_id: scope.tenantId, actor_id: scope.actorId, run_id: scope.runId,
  kind: "chat", version: "fixture-v1", status: "queued", stage: null, steps: 0, calls: 0, input_tokens: 0, output_tokens: 0,
  cost_micros: 0, budget: storedBudget, attempts: 0, error_code: null, result_id: null,
  created_at: new Date(0), updated_at: new Date(0), expires_at: new Date(60000), deadline_at: new Date(30000), approved_by: null });
function fixture(rows: unknown[]) {
  const queries: Array<{ sql: string; parameters: unknown[] }> = [];
  const pool = { query: async (sql: string, parameters: unknown[]) => { queries.push({ sql, parameters }); return { rows }; } } as unknown as Pool;
  return { repository: new PgWorkflowRepository(pool, new WorkflowStateCodec(randomBytes(32).toString("base64"))), queries };
}
test("absent workflow snapshots and empty lists remain absent", async () => {
  const { repository } = fixture([]);
  assert.equal(await repository.get(scope), null); assert.deepEqual(await repository.list(scope.tenantId, "chat", 5), []);
});
test("valid stored budgets retain zero allowances, scoped bindings and the existing list cap", async () => {
  const { repository, queries } = fixture([row()]);
  assert.deepEqual((await repository.get(scope))?.budget, budget);
  assert.deepEqual((await repository.list(scope.tenantId, "chat", 100))[0]?.budget, budget);
  assert.deepEqual(queries[0]!.parameters, [scope.tenantId, scope.actorId, scope.runId]);
  assert.deepEqual(queries[1]!.parameters, [scope.tenantId, "chat", 50]);
});
test("corrupt stored budgets throw fixed server errors for reads and lists without stored key names", async () => {
  for (const invalid of [null, "PRIVATE_BUDGET_SENTINEL", { ...budget, maxCalls: "4" }, { ...budget, timeoutMs: NaN },
    { ...budget, maxInputTokens: null }, { ...budget, PRIVATE_BUDGET_SENTINEL: "not public" }]) {
    const { repository } = fixture([row(invalid)]);
    const safe = (error: unknown) => error instanceof StoredRecordError && error.code === "invalid_stored_record" &&
      !String(error).includes("PRIVATE_BUDGET_SENTINEL") && !JSON.stringify(error).includes("PRIVATE_BUDGET_SENTINEL") && !("cause" in error);
    await assert.rejects(repository.get(scope), safe); await assert.rejects(repository.list(scope.tenantId, "chat", 5), safe);
  }
});
