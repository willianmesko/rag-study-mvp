import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { ConversationDelivery } from "./delivery.js";
import type { ConversationSubmission, PendingConversationSubmission } from "../ports/conversation-repository.js";

function item(input: unknown, mode: unknown = "answer"): PendingConversationSubmission {
  return { tenantId: randomUUID(), userId: randomUUID(), conversationId: randomUUID(), runId: randomUUID(), mode, input };
}
function fixture(items: PendingConversationSubmission[], signal = new AbortController().signal) {
  const failed: string[] = [], delivered: ConversationSubmission[] = [], reports: string[] = [], claimed: string[] = [];
  const records: ConstructorParameters<typeof ConversationDelivery>[0] = {
    async admit() { throw new Error("Recovery must not admit another turn."); },
    async pruneExpired() { return 0; },
    async pending(limit) { assert.equal(limit, 10); return items; },
    async fail(_scope, runId) { failed.push(runId); },
    async claimComparison(_scope, runId) { claimed.push(runId); return false; },
    async turn() { return null; },
    async completeComparison() { throw new Error("An unclaimed comparison must not complete."); }
  };
  const delivery = new ConversationDelivery(records, { get: async () => null },
    async (submission) => { delivered.push(submission); },
    async () => { throw new Error("An unclaimed comparison must not call a provider."); },
    signal, 1000, (reason) => reports.push(reason));
  return { delivery, records, failed, delivered, reports, claimed };
}

test("recovery rejects invalid persisted modes/inputs individually before dispatching other conversations", async () => {
  const invalid = [item(null), item("PRIVATE_SENTINEL"), item({ question: 17 }),
    item({ question: "Synthetic?", modelId: "provider/PRIVATE_SENTINEL" }),
    item({ question: "Synthetic?", previousQuestions: Array(4).fill("PRIVATE_SENTINEL") }),
    item({ question: "Synthetic?" }, "write_tool"), item({ question: "Synthetic?", modelIds: ["default"] }, "comparison")];
  const valid = item({ question: "  Synthetic question?  ", modelId: "default", providerModel: "PRIVATE_SENTINEL" });
  const f = fixture([...invalid, valid]);
  await f.delivery.recover(); await f.delivery.close();
  assert.deepEqual(f.failed, invalid.map(({ runId }) => runId));
  assert.equal(f.delivered.length, 1); assert.equal(f.delivered[0]?.runId, valid.runId);
  assert.equal(f.delivered[0]?.input.question, "  Synthetic question?  ");
  assert.equal(Object.hasOwn(f.delivered[0]!.input, "providerModel"), false);
  assert.deepEqual(f.reports, invalid.map(() => "conversation_recovery_invalid_input"));
  assert.doesNotMatch(JSON.stringify(f.reports), /PRIVATE_SENTINEL/);
});

test("valid recovery retains bounded conversation context and comparison claim/idempotency controls", async () => {
  const answer = item({ question: "Synthetic follow-up?", previousQuestions: ["Earlier synthetic question?"] });
  const comparison = item({ question: "Synthetic comparison?", modelIds: ["default", "alternate"] }, "comparison");
  const f = fixture([answer, comparison]);
  await f.delivery.recover(); await f.delivery.close();
  assert.deepEqual(f.failed, []); assert.deepEqual(f.reports, []);
  const input = f.delivered[0]?.input;
  assert.ok(input && "previousQuestions" in input);
  assert.deepEqual(input.previousQuestions, ["Earlier synthetic question?"]);
  assert.deepEqual(f.claimed, [comparison.runId]);
});

test("an existing run prevents duplicate answer dispatch during recovery", async () => {
  const pending = item({ question: "Synthetic question?" }), f = fixture([pending]);
  const delivery = new ConversationDelivery(f.records, { get: async () => "running" },
    async () => assert.fail("An existing run must not be dispatched again."),
    async () => assert.fail("An answer must not become a comparison."),
    new AbortController().signal, 1000, (reason) => f.reports.push(reason));
  await delivery.recover(); await delivery.close();
  assert.deepEqual(f.failed, []); assert.deepEqual(f.reports, []);
});

test("shutdown stops recovery before dispatch or invalid-record writes", async () => {
  const controller = new AbortController(); controller.abort();
  const f = fixture([item(null), item({ question: "Synthetic question?" })], controller.signal);
  await f.delivery.recover(); await f.delivery.close();
  assert.deepEqual(f.delivered, []); assert.deepEqual(f.failed, []); assert.deepEqual(f.reports, []);
});

test("a failed invalid-record state write is not swallowed or followed by a provider call", async () => {
  const f = fixture([item(null), item({ question: "Synthetic question?" })]);
  const error = new Error("Synthetic state store unavailable.");
  f.records.fail = async () => { throw error; };
  await assert.rejects(f.delivery.recover(), (value) => value === error);
  assert.deepEqual(f.delivered, []); assert.deepEqual(f.reports, []);
});
