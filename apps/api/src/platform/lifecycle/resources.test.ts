import assert from "node:assert/strict";
import test from "node:test";
import { closeApplicationResources } from "./resources.js";

test("application close waits for workflows before closing both owned pools", async () => {
  const order: string[] = [];
  await closeApplicationResources({
    workflows: { async close() { order.push("workflow"); await Promise.resolve(); order.push("workflow-stopped"); } },
    pool: { async end() { order.push("pool"); } },
    mcpReadPool: { async end() { order.push("mcp-pool"); } },
  });
  assert.deepEqual(order, ["workflow", "workflow-stopped", "pool", "mcp-pool"]);
});

test("workflow failure cannot skip either pool and all close failures remain observable", async () => {
  const order: string[] = [];
  const workflowFailure = new Error("Workflow close failed");
  const poolFailure = new Error("Pool close failed");
  await assert.rejects(closeApplicationResources({
    workflows: { async close() { order.push("workflow"); throw workflowFailure; } },
    pool: { async end() { order.push("pool"); throw poolFailure; } },
    mcpReadPool: { async end() { order.push("mcp-pool"); } },
  }), (error) => error instanceof AggregateError && error.errors.length === 2 && error.errors[0] === workflowFailure && error.errors[1] === poolFailure);
  assert.deepEqual(order, ["workflow", "pool", "mcp-pool"]);
});

test("a synchronous pool close error cannot prevent the other close attempt, and optional resources stay optional", async () => {
  let closed = false;
  await assert.rejects(closeApplicationResources({
    pool: { end() { throw new Error("Synchronous failure"); } },
    mcpReadPool: { async end() { closed = true; } },
  }), AggregateError);
  assert.equal(closed, true);
  await closeApplicationResources({ pool: { async end() {} } });
});
