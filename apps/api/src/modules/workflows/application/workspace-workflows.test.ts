import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceWorkflows } from "./workspace-workflows.js";
import type { WorkflowEngine, WorkflowRepository, WorkflowBudget } from "../../../platform/workflows/types.js";

function fixture(close: () => Promise<void>) {
  const repository: WorkflowRepository = {
    admit: async () => { throw new Error("Unexpected admission"); }, claim: async () => null,
    heartbeat: async () => true, release: async () => {}, finish: async () => true,
    reserve: async () => {}, event: async () => {}, get: async () => null, list: async () => [],
    approve: async () => false, cancel: async () => false,
    effect: async (_lease, _key, _amount, operation) => operation(), prune: async () => 0,
  };
  const engine: WorkflowEngine = { repository, register() {}, submit: async () => { throw new Error("Unexpected submit"); }, cancel: async () => false, start() {}, close };
  const budget: WorkflowBudget = { maxSteps: 10, maxCalls: 10, maxInputTokens: 1000, maxOutputTokens: 100, maxCostMicros: 1000, timeoutMs: 1000 };
  return new WorkspaceWorkflows({
    engine, chatVersion: "fixture-chat", evaluationVersion: "fixture-evaluation", chatBudget: budget, evaluationBudget: budget,
    member: async () => null, resolveChat: async () => null, embeddingVersion: async () => "fixture-index",
    consumeQuota: async () => false, runChat: async () => {},
    runEvaluation: { preflight: async () => {}, execute: async () => { throw new Error("Unexpected evaluation"); } },
  });
}

test("app and application close share one workflow shutdown, including reentrant calls", async () => {
  let calls = 0;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  let first!: Promise<void>;
  const workflows = fixture(() => {
    calls++;
    assert.equal(workflows.close(), first);
    return pending;
  });
  first = workflows.close();
  assert.equal(workflows.close(), first);
  assert.equal(calls, 0);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish();
  await first;
  assert.equal(workflows.close(), first);
  assert.equal(calls, 1);
});

test("a failed workflow close retains its rejection without retrying or hiding failure", async () => {
  let calls = 0;
  const failure = new Error("Workflow close failed");
  const workflows = fixture(() => { calls++; throw failure; });
  const first = workflows.close();
  await assert.rejects(first, (error) => error === failure);
  const again = workflows.close();
  assert.equal(again, first);
  await assert.rejects(again, (error) => error === failure);
  assert.equal(calls, 1);
});
