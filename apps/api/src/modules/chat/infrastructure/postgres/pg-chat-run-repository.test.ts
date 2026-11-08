import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { PgChatRunRepository } from "./pg-chat-run-repository.js";
import { StoredRecordError } from "../../../../platform/database/stored-record.js";

const scope = { tenantId: "20000000-0000-4000-8000-000000000001", actorId: "10000000-0000-4000-8000-000000000001", runId: "30000000-0000-4000-8000-000000000001" };
function fixture(responses: Array<{ rows?: unknown[]; rowCount?: number }>) {
  const queries: Array<{ sql: string; parameters: unknown[] }> = [];
  const pool = { query: async (sql: string, parameters: unknown[]) => {
    queries.push({ sql, parameters });
    const response = responses.shift(); assert.ok(response, "Unexpected replay query.");
    return { rows: [], rowCount: 0, ...response };
  } } as unknown as Pool;
  return { repository: new PgChatRunRepository(pool), queries };
}
const row = (event: unknown = { type: "accepted" }) => ({ status: "running", deadline_reached: false, event_id: 1, event });
const sanitized = (error: unknown) => error instanceof StoredRecordError && error.code === "invalid_stored_record" &&
  !JSON.stringify(error).includes("PRIVATE_SENTINEL") && !String(error).includes("PRIVATE_SENTINEL") && !("cause" in error);

test("missing status/page stays absent while a left-joined empty page retains its real run status", async () => {
  const { repository } = fixture([{ rows: [] }, { rows: [] }, { rows: [{ ...row(null), event_id: null, status: "completed" }] }]);
  assert.equal(await repository.get(scope), null);
  assert.equal(await repository.read(scope, 0), null);
  assert.deepEqual(await repository.read(scope, 9), { status: "completed", events: [] });
});
test("status decoding accepts only persisted run states and never converts corruption into a missing run", async () => {
  for (const status of ["running", "completed", "failed", "cancelled"]) {
    assert.equal(await fixture([{ rows: [{ status }] }]).repository.get(scope), status);
  }
  for (const invalid of [{}, { status: null }, { status: "PRIVATE_SENTINEL" }, { status: 1 }]) {
    await assert.rejects(fixture([{ rows: [invalid] }]).repository.get(scope), sanitized);
  }
});
test("checked replay preserves ordered events, scope, cursor and its 64-event SQL limit", async () => {
  const events = [
    { type: "accepted" }, { type: "retrieving" }, { type: "generating" }, { type: "validating" }, { type: "cached" },
    { type: "citations", sources: [] }, { type: "token", delta: "A bounded delta" },
    { type: "completed", response: { answer: "A bounded answer", sources: [], refusalReason: "insufficient_context" } },
    { type: "error", code: "execution_failed", error: "A safe failure" }, { type: "cancelled" }
  ];
  const rows = events.map((event, index) => ({ ...row(event), event_id: index + 4 }));
  const { repository, queries } = fixture([{ rows }]);
  assert.deepEqual(await repository.read(scope, 3), { status: "running", events: events.map((event, index) => ({ id: index + 4, event })) });
  assert.deepEqual(queries[0]!.parameters, [scope.tenantId, scope.actorId, scope.runId, 3, 64]);
  assert.match(queries[0]!.sql, /r\.tenant_id = \$1 AND r\.actor_id = \$2 AND r\.run_id = \$3/);
});
test("corrupt stored tokens, citations and terminal payloads fail with fixed server diagnostics", async () => {
  for (const event of [{ type: "token", delta: 5, private: "PRIVATE_SENTINEL" }, { type: "citations", sources: "PRIVATE_SENTINEL" },
    { type: "completed", response: { answer: "PRIVATE_SENTINEL" } }, { type: "PRIVATE_SENTINEL" }]) {
    await assert.rejects(fixture([{ rows: [row(event)] }]).repository.read(scope, 0), sanitized);
  }
});
test("physical rows reject truthy flags, invalid sequences, mismatched joined nulls and an oversized page", async () => {
  for (const invalid of [{ ...row(), deadline_reached: "false" }, { ...row(), event_id: "1" },
    { ...row(), event_id: 0 }, { ...row(), event_id: 513 }, { ...row(), event_id: null }, row(null)]) {
    await assert.rejects(fixture([{ rows: [invalid] }]).repository.read(scope, 0), sanitized);
  }
  await assert.rejects(fixture([{ rows: Array.from({ length: 65 }, () => row()) }]).repository.read(scope, 0), sanitized);
});
test("deadline reconciliation retains its existing transition and decodes the reread page", async () => {
  const terminal = { type: "error", code: "execution_interrupted", error: "The answer was interrupted. Ask again to start a new run." };
  const { repository, queries } = fixture([{ rows: [{ ...row(), deadline_reached: true }] }, { rowCount: 1 },
    { rows: [{ ...row(terminal), event_id: 2, status: "failed", deadline_reached: true }] }]);
  assert.deepEqual(await repository.read(scope, 0), { status: "failed", events: [{ id: 2, event: terminal }] });
  assert.equal(queries.length, 3);
  assert.equal(queries[1]!.parameters[3], "failed");
});
