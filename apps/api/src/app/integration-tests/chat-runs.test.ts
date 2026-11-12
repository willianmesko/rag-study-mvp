import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { chatRunEventSchema, type ChatRunEvent } from "@rag-study/contracts";
import type { ChatRunRepository, ChatRunScope, ChatRunSnapshot } from "../../modules/chat/application/ports/chat-run-repository.js";
import type { AnswerQuestionResult } from "../../modules/chat/application/ports/question-answering-workflow.js";
import type { AnswerQuestionUseCase } from "../../modules/chat/application/use-cases/answer-question.js";
import { parseRuntimeConfiguration } from "../configuration/environment.js";
import { buildNestTestApp as buildApp } from "./nest-http-test-fixture.js";

const fetchHttp = globalThis.fetch;
const authUrl = "https://chat-auth.example.test";
const actorId = "a28671d0-01c3-4da5-9fd6-213e8b5fe2d2";
const peerId = "88d9b4d7-d262-4c91-b515-77f7d108fa1e";
const workspaceId = "78f3dc21-ad30-4753-be9c-5e9d32e2135f";
const otherWorkspaceId = "7ab25861-e3ef-44be-8058-5aad76ffab96";
const headers = { authorization: "Bearer chat-user", "x-workspace-id": workspaceId };
const answer: AnswerQuestionResult = {
  answer: "The retention period is five days.",
  sources: [{ chunkId: "chunk-1", documentId: "document-1", source: "handbook.md", title: "Handbook", ordinal: 0,
    score: 0.81, content: "Records are kept for five days. Contact private@example.com for details." }],
  citedChunkIds: ["chunk-1"],
  structuredOutput: true
};

class FixtureChatRuns implements ChatRunRepository {
  private readonly runs = new Map<string, ChatRunSnapshot>();

  private key({ tenantId, actorId, runId }: ChatRunScope) { return `${tenantId}:${actorId}:${runId}`; }

  async create(scope: ChatRunScope) {
    const key = this.key(scope);
    if (this.runs.has(key)) return false;
    this.runs.set(key, { status: "running", events: [{ id: 1, event: { type: "accepted" } }] });
    return true;
  }

  async append(scope: ChatRunScope, events: ChatRunEvent[], status?: "completed" | "failed") {
    const run = this.runs.get(this.key(scope));
    if (!run || run.status !== "running") return false;
    for (const event of events) run.events.push({ id: run.events.length + 1, event });
    if (status) run.status = status;
    return true;
  }

  async cancel(scope: ChatRunScope) {
    const run = this.runs.get(this.key(scope));
    if (!run) return null;
    if (run.status === "running") {
      run.status = "cancelled";
      run.events.push({ id: run.events.length + 1, event: { type: "cancelled" } });
    }
    return run.status;
  }

  async get(scope: ChatRunScope) { return this.runs.get(this.key(scope))?.status ?? null; }

  async read(scope: ChatRunScope, after: number) {
    const run = this.runs.get(this.key(scope));
    return run ? { status: run.status, events: run.events.filter(({ id }) => id > after).slice(0, 64) } : null;
  }

  async pruneExpired() { return 0; }
}

async function fixture(t: TestContext, execute: AnswerQuestionUseCase["execute"]) {
  const configuration = parseRuntimeConfiguration({ SUPABASE_URL: authUrl, SUPABASE_PUBLISHABLE_KEY: "fixture-publishable-key",
    AGENT_TIMEOUT_MS: "8000", RATE_LIMIT_MAX: "60", QA_RATE_LIMIT_MAX: "20" });
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    assert.equal(String(url), `${authUrl}/auth/v1/user`);
    const authorization = new Headers(init?.headers).get("authorization");
    if (authorization === "Bearer chat-user" || authorization === "Bearer chat-peer") {
      return Response.json({ id: authorization === "Bearer chat-user" ? actorId : peerId, aud: "authenticated", role: "authenticated" });
    }
    return Response.json({ message: "Invalid token" }, { status: 401 });
  });
  const consumeQuestionQuota = t.mock.fn(async (_tenantId: string, _actorKey: string) => ({ allowed: true, used: 1, limit: 10 }));
  const answerQuestion = t.mock.fn(execute);
  const dependencies = {
    chatRuns: new FixtureChatRuns(), consumeQuestionQuota, answerQuestion: { execute: answerQuestion },
    findMembership: async (user: string, tenantId: string) => {
      const allowed = tenantId === workspaceId || (tenantId === otherWorkspaceId && user === actorId);
      return allowed ? { tenantId, tenantName: "Fixture", tenantSlug: "fixture", role: "viewer" } : null;
    }
  } as unknown as Parameters<typeof buildApp>[0];

  async function listen() {
    const app = await buildApp(dependencies, { configuration, isProduction: true });
    t.after(() => app.close());
    return app.listen({ host: "127.0.0.1", port: 0 });
  }
  const base = await listen();
  return { base, listen, answerQuestion, consumeQuestionQuota };
}

function start(base: string, runId: string, signal = AbortSignal.timeout(6_000)) {
  return fetchHttp(`${base}/v1/qa/stream`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, signal,
    body: JSON.stringify({ runId, question: "How long are records kept?" })
  });
}

function eventsUrl(base: string, runId: string, after = 0) { return `${base}/v1/qa/runs/${runId}/events?after=${after}`; }
function cancelUrl(base: string, runId: string) { return `${base}/v1/qa/runs/${runId}/cancel`; }

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function parseFrames(frames: string[]) {
  return frames.filter((frame) => frame.startsWith("id:")).map((frame) => {
    const [id, name, data] = frame.split("\n");
    const event = chatRunEventSchema.parse(JSON.parse(data!.slice("data: ".length)));
    assert.equal(name, `event: ${event.type}`);
    return { id: Number(id!.slice("id: ".length)), event };
  });
}

async function receiveUntil(response: Response, type: ChatRunEvent["type"]) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: ChatRunSnapshot["events"] = [];
  try {
    while (!events.some(({ event }) => event.type === type)) {
      const { done, value } = await reader.read();
      assert.equal(done, false, `Stream ended before ${type}`);
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      events.push(...parseFrames(frames));
    }
    return events;
  } finally {
    reader.releaseLock();
  }
}

test("the same run replays only unseen events across connections and charges quota once", async (t) => {
  const releaseAnswer = latch();
  const { base, answerQuestion, consumeQuestionQuota } = await fixture(t, async ({ onEvent, signal }) => {
    assert.ok(signal);
    await onEvent?.({ type: "retrieving" });
    await onEvent?.({ type: "generating" });
    signal.throwIfAborted();
    await Promise.race([releaseAnswer.promise, once(signal, "abort")]);
    signal.throwIfAborted();
    await onEvent?.({ type: "validating" });
    await onEvent?.({ type: "citations", sources: answer.sources });
    await onEvent?.({ type: "token", delta: answer.answer });
    return answer;
  });
  const runId = randomUUID();
  const disconnect = new AbortController();
  const first = await start(base, runId, AbortSignal.any([disconnect.signal, AbortSignal.timeout(6_000)]));
  const before = await receiveUntil(first, "generating");
  assert.deepEqual(before.map(({ id, event }) => [id, event.type]), [[1, "accepted"], [2, "retrieving"], [3, "generating"]]);
  disconnect.abort();

  const [resumed, duplicate] = await Promise.all([
    fetchHttp(eventsUrl(base, runId, 3), { headers, signal: AbortSignal.timeout(6_000) }),
    start(base, runId)
  ]);
  releaseAnswer.resolve();
  assert.equal(resumed.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(resumed.headers.get("cache-control"), "no-store, no-transform");
  const replay = parseFrames((await resumed.text()).split("\n\n"));
  assert.deepEqual(replay.map(({ id, event }) => [id, event.type]), [[4, "validating"], [5, "citations"], [6, "token"], [7, "completed"]]);
  assert.deepEqual(parseFrames((await duplicate.text()).split("\n\n")), [...before, ...replay]);
  const cited = replay[1]?.event;
  assert.ok(cited?.type === "citations");
  assert.equal(cited.sources[0]?.chunkId, "chunk-1");
  assert.doesNotMatch(cited.sources[0]!.excerpt, /private@example\.com/);
  const completed = replay.at(-1)?.event;
  assert.ok(completed?.type === "completed");
  assert.equal(completed.response.answer, answer.answer);
  assert.equal(answerQuestion.mock.callCount(), 1);
  assert.deepEqual(consumeQuestionQuota.mock.calls.map(({ arguments: args }) => args), [[workspaceId, `user:${actorId}`]]);
});

test("a cancellation on another API instance reaches the running provider signal", async (t) => {
  const providerAborted = latch();
  const { base, listen } = await fixture(t, async ({ onEvent, signal }) => {
    assert.ok(signal);
    await onEvent?.({ type: "generating" });
    if (!signal.aborted) await once(signal, "abort");
    providerAborted.resolve();
    signal.throwIfAborted();
    return answer;
  });
  const other = await listen();
  const runId = randomUUID();
  const active = await start(base, runId);
  const initial = await receiveUntil(active, "generating");
  const response = await fetchHttp(cancelUrl(other, runId), { method: "POST", headers, signal: AbortSignal.timeout(6_000) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "cancelled" });
  await Promise.race([providerAborted.promise, delay(3_000, undefined, { ref: false }).then(() => assert.fail("Cancellation did not reach the provider."))]);
  assert.deepEqual(await receiveUntil(active, "cancelled"), [{ id: initial.at(-1)!.id + 1, event: { type: "cancelled" } }]);
  const replay = await fetchHttp(eventsUrl(other, runId), { headers, signal: AbortSignal.timeout(6_000) });
  assert.deepEqual(parseFrames((await replay.text()).split("\n\n")).map(({ event }) => event.type), ["accepted", "generating", "cancelled"]);
});

test("chat run replay and cancellation require the original workspace and actor", async (t) => {
  const { base } = await fixture(t, async () => answer);
  const runId = randomUUID();
  const original = await start(base, runId);
  assert.equal(original.status, 200);
  assert.match(await original.text(), /event: completed/);
  const attempts: { requestHeaders: Record<string, string>; status: number }[] = [
    { requestHeaders: {}, status: 401 },
    { requestHeaders: { authorization: headers.authorization }, status: 400 },
    { requestHeaders: { ...headers, "x-workspace-id": randomUUID() }, status: 403 },
    { requestHeaders: { ...headers, "x-workspace-id": otherWorkspaceId }, status: 404 },
    { requestHeaders: { ...headers, authorization: "Bearer chat-peer" }, status: 404 }
  ];
  for (const { requestHeaders, status } of attempts) {
    for (const [url, method] of [[eventsUrl(base, runId), "GET"], [cancelUrl(base, runId), "POST"]] as const) {
      const response = await fetchHttp(url, { method, headers: requestHeaders, signal: AbortSignal.timeout(6_000) });
      assert.equal(response.status, status);
      assert.doesNotMatch(await response.text(), /retention period/);
    }
  }
});

test("a provider error is replayable without exposing raw error details", async (t) => {
  const { base } = await fixture(t, async () => { throw new Error("private-provider-error-details"); });
  const runId = randomUUID();
  const original = await start(base, runId);
  const raw = await original.text();
  assert.doesNotMatch(raw, /private-provider-error-details/);
  const events = parseFrames(raw.split("\n\n"));
  const terminal = events.at(-1)?.event;
  assert.ok(terminal?.type === "error");
  assert.equal(terminal.code, "execution_failed");
  const replay = await fetchHttp(eventsUrl(base, runId, 1), { headers, signal: AbortSignal.timeout(6_000) });
  assert.deepEqual(parseFrames((await replay.text()).split("\n\n")), events.slice(1));
});

test("a durable follow-up runs with its workspace and ephemeral prior questions", async (t) => {
  const previousQuestions = ["What is the policy for retained records?"];
  const { base, answerQuestion, consumeQuestionQuota } = await fixture(t, async (input) => {
    assert.equal(input.tenantId, workspaceId);
    assert.equal(input.actorKey, `user:${actorId}`);
    assert.deepEqual(input.previousQuestions, previousQuestions);
    return answer;
  });
  const runId = randomUUID();
  const response = await fetchHttp(`${base}/v1/qa/stream`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, signal: AbortSignal.timeout(6_000),
    body: JSON.stringify({ runId, question: "And for how long?", previousQuestions })
  });
  assert.equal(response.status, 200);
  const events = await response.text();
  assert.match(events, /event: completed/);
  assert.doesNotMatch(events, /What is the policy for retained records/);
  const replay = await start(base, runId);
  assert.equal(await replay.text(), events);
  assert.equal(answerQuestion.mock.callCount(), 1);
  assert.equal(consumeQuestionQuota.mock.callCount(), 1);
});
