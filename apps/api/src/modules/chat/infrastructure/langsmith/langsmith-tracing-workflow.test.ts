import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import { Client } from "langsmith";
import { RunTree } from "langsmith/run_trees";
import { traceable, withRunTree } from "langsmith/traceable";
import { withCorrelation } from "../../../../platform/observability/observer.js";
import type { AnswerQuestionResult, AnswerWorkflowEvent, AnswerWorkflowInput, QuestionAnsweringWorkflow } from "../../application/ports/question-answering-workflow.js";
import { AnswerQuestionUseCase } from "../../application/use-cases/answer-question.js";
import { LangSmithTracingWorkflow } from "./langsmith-tracing-workflow.js";

let networkCalls = 0;
const network = mock.method(globalThis, "fetch", async () => {
  networkCalls++;
  throw new Error("Trace tests must not access the network.");
});
after(() => { network.mock.restore(); assert.equal(networkCalls, 0); });

class RecordingClient extends Client {
  readonly creates: Parameters<Client["createRun"]>[0][] = [];
  readonly updates: { id: string; run: Parameters<Client["updateRun"]>[1] }[] = [];
  failCreate = false;
  failUpdate = false;
  constructor() { super({ apiUrl: "https://tracing.invalid", apiKey: "fixture-only", autoBatchTracing: false }); }
  override async createRun(run: Parameters<Client["createRun"]>[0]) {
    this.creates.push(structuredClone(run));
    if (this.failCreate) throw new Error("Synthetic trace export unavailable.");
  }
  override async updateRun(id: string, run: Parameters<Client["updateRun"]>[1]) {
    this.updates.push({ id, run: structuredClone(run) });
    if (this.failUpdate) throw new Error("Synthetic trace update unavailable.");
  }
}

const input = (signal?: AbortSignal): AnswerWorkflowInput => ({
  question: "PRIVATE_QUESTION credential=SECRET_VALUE", tenantId: "PRIVATE_TENANT",
  queryEmbedding: [0.123456789, 0.987654321], embeddingIndexVersion: "PRIVATE_INDEX",
  topK: 3, signal,
});
const answer: AnswerQuestionResult = {
  answer: "PRIVATE_ANSWER", sources: [{ chunkId: "PRIVATE_CHUNK", documentId: "PRIVATE_DOCUMENT",
    source: "PRIVATE_FILENAME.md", title: "PRIVATE_TITLE", content: "PRIVATE_PASSAGE",
    ordinal: 0, score: 0.9 }], providerModel: "PRIVATE_MODEL", refusalReason: "PRIVATE_REFUSAL",
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const wrap = (workflow: QuestionAnsweringWorkflow, client: RecordingClient, enabled = true) =>
  new LangSmithTracingWorkflow(workflow, { enabled, projectName: "fixture-project", client });
function privateDataAbsent(client: RecordingClient) {
  assert.doesNotMatch(JSON.stringify({ creates: client.creates, updates: client.updates }),
    /PRIVATE_|SECRET_VALUE|0\.123456789|0\.987654321/);
}
function oneTrace(client: RecordingClient) {
  assert.equal(client.creates.length, 1); assert.equal(client.updates.length, 1);
  assert.equal(client.updates[0].id, client.creates[0].id);
  assert.equal(client.creates[0].name, "rag-question-workflow");
  assert.ok("session_name" in client.creates[0]);
  assert.equal(client.creates[0].session_name, "fixture-project");
  assert.ok(client.updates[0].run.end_time);
  privateDataAbsent(client);
  return client.updates[0].run;
}

test("stream events retain identity/order and await backpressure before one safe trace completes", async () => {
  const client = new RecordingClient(), paused = deferred(), arrived = deferred();
  const value = input(new AbortController().signal);
  const events: AnswerWorkflowEvent[] = [{ type: "retrieving" }, { type: "generating" },
    { type: "citations", sources: answer.sources }, { type: "token", delta: "PRIVATE_TOKEN" }, { type: "validating" }];
  const observed: AnswerWorkflowEvent[] = [];
  let calls = 0;
  const onEvent = async (event: AnswerWorkflowEvent) => {
    observed.push(event);
    if (event === events[0]) { arrived.resolve(); await paused.promise; }
  };
  const workflow = wrap({ answer: async () => { throw new Error("Stream must be selected."); },
    answerStream: async (received, callback) => {
      calls++; assert.equal(received, value); assert.equal(callback, onEvent);
      for (const event of events) await callback(event);
      return answer;
    } }, client);
  const correlation = "10000000-0000-4000-8000-000000000001";
  const running = withCorrelation(correlation, () => workflow.answerStream(value, onEvent));
  await arrived.promise;
  assert.deepEqual(observed, [events[0]]); assert.equal(client.updates.length, 0);
  paused.resolve(); assert.equal(await running, answer);
  assert.equal(calls, 1); assert.deepEqual(observed, events);
  const result = oneTrace(client);
  assert.deepEqual(client.creates[0].inputs, { questionCharacters: value.question.length, topK: 3 });
  assert.equal(client.creates[0].extra?.metadata?.correlation_id, correlation);
  assert.equal(client.creates[0].extra?.metadata?.mode, "answer_stream");
  assert.deepEqual(result.outputs, { outcome: "completed", sourceCount: 1, refused: true });
  assert.equal(result.error, undefined);
});

test("direct answers and stream fallback each execute once and preserve result identity", async () => {
  for (const mode of ["answer", "answerStream"] as const) {
    const client = new RecordingClient(); let calls = 0;
    const value = input();
    const workflow = wrap({ answer: async (received) => { calls++; assert.equal(received, value); return answer; } }, client);
    const result = mode === "answer" ? await workflow.answer(value) : await workflow.answerStream(value, () => { throw new Error("No synthetic stream events."); });
    assert.equal(result, answer); assert.equal(calls, 1); oneTrace(client);
    assert.equal(client.creates[0].extra?.metadata?.mode, mode === "answer" ? "answer" : "answer_stream");
  }
});

test("workflow failures preserve original error identity without exporting its message, cause or stack", async () => {
  const client = new RecordingClient();
  const failure = new Error("PRIVATE_ERROR SECRET_VALUE", { cause: new Error("PRIVATE_CAUSE") });
  const workflow = wrap({ answer: async () => { throw failure; } }, client);
  await assert.rejects(workflow.answerStream(input(), () => {}), (error) => error === failure);
  const result = oneTrace(client);
  assert.equal(result.error, "workflow_failed"); assert.deepEqual(result.outputs, { outcome: "workflow_failed" });
});

test("callback rejection ends the trace and never replays generation or event delivery", async () => {
  const client = new RecordingClient(), failure = new Error("PRIVATE_CALLBACK SECRET_VALUE");
  let calls = 0, deliveries = 0;
  const workflow = wrap({ answer: async () => answer, answerStream: async (_value, onEvent) => {
    calls++; await onEvent({ type: "token", delta: "PRIVATE_TOKEN" });
    throw new Error("The rejected callback must stop the workflow.");
  } }, client);
  await assert.rejects(workflow.answerStream(input(), async () => { deliveries++; throw failure; }), (error) => error === failure);
  assert.equal(calls, 1); assert.equal(deliveries, 1);
  assert.equal(oneTrace(client).error, "workflow_failed");
});

test("cancellation reaches the workflow with the same signal and opaque reason without another event", async () => {
  const client = new RecordingClient(), controller = new AbortController();
  const reason = { detail: "PRIVATE_CANCELLATION SECRET_VALUE" };
  let deliveries = 0;
  const workflow = wrap({ answer: async () => answer, answerStream: async (value, onEvent) => {
    assert.equal(value.signal, controller.signal);
    await onEvent({ type: "generating" });
    value.signal?.throwIfAborted();
    await onEvent({ type: "token", delta: "PRIVATE_LATE_TOKEN" }); return answer;
  } }, client);
  await assert.rejects(workflow.answerStream(input(controller.signal), () => { deliveries++; controller.abort(reason); }), (error) => error === reason);
  assert.equal(deliveries, 1); assert.equal(oneTrace(client).error, "cancelled");
});

test("already-cancelled work and deadline reasons retain identity and fixed reason codes", async () => {
  for (const timeout of [false, true]) {
    const client = new RecordingClient(), controller = new AbortController();
    const reason = timeout ? new DOMException("PRIVATE_TIMEOUT", "TimeoutError") : new Error("PRIVATE_ABORT");
    controller.abort(reason); let effects = 0;
    const workflow = wrap({ answer: async (value) => { value.signal?.throwIfAborted(); effects++; return answer; } }, client);
    await assert.rejects(workflow.answerStream(input(controller.signal), () => { effects++; }), (error) => error === reason);
    assert.equal(effects, 0); assert.equal(oneTrace(client).error, timeout ? "deadline_exceeded" : "cancelled");
  }
});

test("disabled tracing and conversation history suppress ambient and nested SDK traces in both paths", async () => {
  for (const enabled of [false, true]) for (const mode of ["answer", "answerStream"] as const) {
    const client = new RecordingClient();
    const parent = new RunTree({ name: "ambient-fixture", client, tracingEnabled: true });
    const nested = traceable(async () => answer, { name: "PRIVATE_NESTED" });
    const workflow = wrap({ answer: nested, answerStream: async (_value, callback) => {
      await callback({ type: "token", delta: "PRIVATE_TOKEN" }); return nested();
    } }, client, enabled);
    const value = { ...input(), ...(enabled ? { previousQuestions: ["PRIVATE_HISTORY"] } : {}) };
    const actual = await withRunTree(parent, () => mode === "answer"
      ? workflow.answer(value) : workflow.answerStream(value, async () => {}));
    assert.equal(actual, answer); assert.equal(client.creates.length, 0); assert.equal(client.updates.length, 0);
  }
});

test("an enabled safe root does not inherit private ambient metadata or export nested payloads", async () => {
  const client = new RecordingClient();
  const parent = new RunTree({ name: "PRIVATE_PARENT", client, metadata: { private: "PRIVATE_METADATA" }, tracingEnabled: true });
  const nested = traceable(async () => answer, { name: "PRIVATE_NESTED" });
  const workflow = wrap({ answer: nested }, client);
  assert.equal(await withRunTree(parent, () => withCorrelation("PRIVATE_CORRELATION", () => workflow.answer(input()))), answer);
  oneTrace(client); assert.equal(client.creates[0].parent_run_id, undefined);
  assert.equal(client.creates[0].extra?.metadata?.correlation_id, undefined);
});

test("trace create/update outages preserve business results and original workflow failures", async () => {
  const logging = mock.method(console, "error", () => {});
  try {
    for (const fails of ["create", "update"] as const) for (const rejected of [false, true]) {
      const client = new RecordingClient(); client.failCreate = fails === "create"; client.failUpdate = fails === "update";
      const failure = new Error("PRIVATE_ORIGINAL_FAILURE"); let calls = 0;
      const workflow = wrap({ answer: async () => { calls++; if (rejected) throw failure; return answer; } }, client);
      if (rejected) await assert.rejects(workflow.answerStream(input(), () => {}), (error) => error === failure);
      else assert.equal(await workflow.answerStream(input(), () => {}), answer);
      assert.equal(calls, 1); oneTrace(client);
    }
  } finally { logging.mock.restore(); }
});

test("concurrent executions isolate their summaries, correlations and terminal error state", async () => {
  const client = new RecordingClient(), gate = deferred(), arrived = deferred();
  const failure = new Error("PRIVATE_CONCURRENT_FAILURE"); let calls = 0;
  const workflow = wrap({ answer: async () => answer, answerStream: async (value) => {
    calls++; if (value.topK === 1) { arrived.resolve(); await gate.promise; throw failure; }
    return answer;
  } }, client);
  const firstId = "10000000-0000-4000-8000-000000000001", secondId = "10000000-0000-4000-8000-000000000002";
  const first = withCorrelation(firstId, () => workflow.answerStream({ ...input(), topK: 1 }, () => {}));
  const rejected = assert.rejects(first, (error) => error === failure);
  await arrived.promise;
  assert.equal(await withCorrelation(secondId, () => workflow.answerStream({ ...input(), topK: 2 }, () => {})), answer);
  gate.resolve(); await rejected;
  assert.equal(calls, 2); assert.equal(client.creates.length, 2); assert.equal(client.updates.length, 2);
  for (const created of client.creates) {
    const updated = client.updates.find((item) => item.id === created.id)?.run;
    assert.ok(updated?.end_time);
    assert.equal(updated.error, created.extra?.metadata?.correlation_id === firstId ? "workflow_failed" : undefined);
  }
  privateDataAbsent(client);
});

test("the real answer use case selects the traced stream and records usage without changing its contract", async () => {
  const client = new RecordingClient(), events: AnswerWorkflowEvent[] = [];
  const value = { ...answer, refusalReason: undefined, structuredOutput: true };
  const workflow = wrap({ answer: async () => { throw new Error("Use case should select streaming."); },
    answerStream: async (_input, onEvent) => { await onEvent({ type: "generating" }); await onEvent({ type: "validating" }); return value; } }, client);
  let recorded = 0;
  const useCase = new AnswerQuestionUseCase(workflow, { embed: async () => [1] },
    { findSimilar: async () => null, put: async () => {}, invalidateTenant: async () => {} },
    { record: async () => { recorded++; }, summarize: async () => { throw new Error("No summary in this fixture."); } },
    { cacheTtlSeconds: 60, cacheMinimumSimilarity: .95, provider: "fixture", model: "fixture",
      maxOutputTokens: 100, maxEstimatedCostUsd: .1, inputCostPer1kUsd: 0, outputCostPer1kUsd: 0 });
  const output = await useCase.execute({ question: "A synthetic question", tenantId: "fixture-workspace",
    actorKey: "fixture-actor", bypassCache: true, onEvent: (event) => { events.push(event); } });
  assert.equal(output.answer, value.answer); assert.equal(recorded, 1);
  assert.deepEqual(events, [{ type: "generating" }, { type: "validating" }]);
  assert.equal(output.usage?.safetyOutcome, "validated"); oneTrace(client);
});
