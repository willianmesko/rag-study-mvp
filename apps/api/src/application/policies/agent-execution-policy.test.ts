import assert from "node:assert/strict";
import test from "node:test";
import { assertStepBudget, assertToolAllowed, readOnlyWorkspaceTools } from "./agent-execution-policy.js";

test("agent policy rejects steps beyond the configured budget", () => {
  assert.throws(() => assertStepBudget(4, { maxSteps: 3 }), /step budget/i);
});

test("agent policy only permits allowlisted read-only tools", () => {
  assert.doesNotThrow(() => assertToolAllowed("search_workspace", readOnlyWorkspaceTools, { maxToolCalls: 2 }, 0));
  assert.throws(() => assertToolAllowed("send_email", readOnlyWorkspaceTools, { maxToolCalls: 2 }, 0), /allowlisted/i);
  assert.throws(() => assertToolAllowed("search_workspace", readOnlyWorkspaceTools, { maxToolCalls: 1 }, 1), /tool-call budget/i);
});
