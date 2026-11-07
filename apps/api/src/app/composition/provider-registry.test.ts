import assert from "node:assert/strict";
import test from "node:test";
import { chatModelDescriptorSchema } from "@rag-study/contracts";
import { createModelRuntimeProviders } from "../../modules/ai/ai.module.js";
import type { ModelRuntimeIdentity, ModelRuntimeMeasurements, ProviderTokenUsage, Reranker } from "../../modules/ai/index.js";
import { WorkflowGuardError } from "../../platform/workflows/types.js";
import { withTransientBudget } from "../../platform/workflows/transient-budget.js";
import { createProviderRegistry, createWorkflowModelGuards } from "./provider-registry.js";

const identity: ModelRuntimeIdentity = {
  provider: "fixture-ai", model: "fixture/model", inputCostPer1kUsd: 0.02, outputCostPer1kUsd: 0.04,
};
const localReranker = (): Reranker => ({ enabled: false, rerank: async (input) => input.candidates.slice(0, input.limit) });
const budget = { maxSteps: 20, maxCalls: 1, maxInputTokens: 100_000, maxOutputTokens: 1_000, maxCostMicros: 1_000_000, timeoutMs: 2_000 };

test("a new backend chat provider runs through unchanged core policy, redaction, pricing and guards", async () => {
  let calls = 0;
  const observed: ProviderTokenUsage[] = [];
  const metadata: Array<{ provider: string; model: string; inputPrice: number; outputPrice: number }> = [];
  const registry = createProviderRegistry([{
    id: identity.provider,
    createAnswer: ({ model, maxOutputTokens }) => {
      assert.equal(model, identity.model);
      assert.equal(maxOutputTokens, 100);
      return {
        async generate(question, context, signal, onUsage, previous) {
          calls++;
          assert.equal(question, "Contact [REDACTED_EMAIL]");
          assert.equal(context, "Owner [REDACTED_EMAIL]");
          assert.deepEqual(previous, ["Email [REDACTED_EMAIL]"]);
          assert.ok(signal);
          onUsage?.({ inputTokens: 12, outputTokens: 4, costUsd: 0.000123 });
          return "Contact answer@example.test";
        },
      };
    },
  }], localReranker);
  const measurements: ModelRuntimeMeasurements = {
    evaluationGenerator(inner, value) { metadata.push(value); return inner; },
    judge(inner) { return inner; },
  };
  const runtime = createModelRuntimeProviders({ registry, guards: createWorkflowModelGuards(), measurements, options: { claimMode: "model" } });
  const generator = runtime.createAnswer({ ...identity, checkpointKey: "unchanged-model-price-key", maxOutputTokens: 100 });
  assert.equal(generator.checkpointKey, "unchanged-model-price-key");
  await withTransientBudget(budget, async () => {
    assert.equal(await generator.generate("Contact user@example.test", "Owner owner@example.test", undefined,
      (usage) => observed.push(usage), ["Email previous@example.test"]), "Contact [REDACTED_EMAIL]");
    await assert.rejects(generator.generate("Another question", "Context"), (error: unknown) => error instanceof WorkflowGuardError && error.code === "budget_exceeded");
  });
  assert.equal(calls, 1, "the guard rejects a second provider call before invoking the adapter");
  assert.deepEqual(observed, [{ inputTokens: 12, outputTokens: 4, costUsd: 0.000123 }]);
  assert.deepEqual(metadata, [{ provider: identity.provider, model: identity.model, inputPrice: 0.02, outputPrice: 0.04 }]);
  assert.equal(runtime.createClaimVerifier(identity).requiresExtractiveAnswer, true, "missing optional judge capability retains extractive policy");
  assert.equal(runtime.createEvaluationJudge(), undefined);
  assert.equal(chatModelDescriptorSchema.safeParse({ id: "fixture", label: "Fixture", provider: identity.provider, isDefault: false }).success, false,
    "an internal provider registration does not broaden the browser catalog");
});

test("optional judging capabilities preserve actual provider/model prices and operation labels", async () => {
  const labels: string[] = [];
  const metadata: unknown[] = [];
  const registry = createProviderRegistry([{
    id: identity.provider,
    createJudge: (model) => ({ model, assess: async () => [{ claim: "A grounded answer.", evidence: "A grounded answer." }] }),
  }], localReranker);
  const runtime = createModelRuntimeProviders({
    registry, guards: createWorkflowModelGuards(), options: { claimMode: "model", evaluationJudge: identity },
    measurements: {
      evaluationGenerator(inner) { return inner; },
      judge(inner, value, operation) { labels.push(operation); metadata.push(value); return inner; },
    },
  });
  const verifier = runtime.createClaimVerifier(identity);
  const judge = runtime.createEvaluationJudge();
  assert.equal(verifier.requiresExtractiveAnswer, false);
  assert.equal(judge?.model, identity.model);
  assert.equal((await verifier.verify("A grounded answer.", [{ chunkId: "chunk", documentId: "document", ordinal: 0,
    source: "guide.md", title: null, content: "A grounded answer.", score: 0.9 }], AbortSignal.timeout(1_000))).supported, true);
  assert.deepEqual(labels, ["evidence_judging", "evaluation_judging"]);
  assert.deepEqual(metadata, [0, 1].map(() => ({ provider: identity.provider, model: identity.model, inputPrice: 0.02, outputPrice: 0.04 })));
});

test("registry selection fails closed and native output overruns retain guard identity", async () => {
  let calls = 0;
  const registration = {
    id: identity.provider,
    createAnswer: () => ({ generate: async (_question: string, _context: string, _signal?: AbortSignal, onUsage?: (usage: ProviderTokenUsage) => void) => {
      calls++;
      onUsage?.({ inputTokens: 1, outputTokens: 101 });
      return "Too many tokens";
    } }),
  };
  assert.throws(() => createProviderRegistry([registration, registration], localReranker), /unique/);
  const registry = createProviderRegistry([registration], localReranker);
  assert.ok(Object.isFrozen(registry));
  assert.throws(() => registry.createAnswer({ provider: "unregistered", model: "arbitrary/model", maxOutputTokens: 100 }), /not registered/);
  const runtime = createModelRuntimeProviders({ registry, guards: createWorkflowModelGuards(), options: { claimMode: "extractive" },
    measurements: { evaluationGenerator: (inner) => inner, judge: (inner) => inner } });
  const generator = runtime.createAnswer({ ...identity, checkpointKey: "guarded", maxOutputTokens: 100 });
  await assert.rejects(generator.generate("Question", "Context"), (error: unknown) => error instanceof WorkflowGuardError && error.code === "budget_exceeded");
  const stop = new AbortController();
  stop.abort(new Error("fixture stop"));
  await assert.rejects(generator.generate("Question", "Context", stop.signal), (error: unknown) => error === stop.signal.reason);
  assert.equal(calls, 1, "already cancelled work never reaches the provider");
});

test("configured deadlines reach every HTTP/SDK adapter, including streaming, embedding, judging and reranking", async (t) => {
  const { parseRuntimeConfiguration } = await import("../configuration/environment.js");
  const { createConfiguredProviderBindings } = await import("./provider-registry.js");
  const { BedrockRuntimeClient, InvokeModelCommand, ConverseStreamCommand } = await import("@aws-sdk/client-bedrock-runtime");
  const observed: number[] = [], nativeTimeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (ms: number) => { observed.push(ms); return nativeTimeout(ms); });
  let httpCalls = 0, sdkCalls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    httpCalls++; assert.ok(init.signal); const body = JSON.parse(String(init.body));
    if (url.endsWith("/api/embed")) return Response.json({ embeddings: [[1, 0]] });
    if (url.endsWith("/embeddings")) return Response.json({ data: [{ embedding: [1, 0] }] });
    if (url.endsWith("/rerank")) return Response.json({ results: [{ index: 0, relevance_score: 0.9 }] });
    if (url.endsWith("/api/chat")) return body.stream
      ? new Response(JSON.stringify({ message: { content: "Synthetic answer." }, done: true }) + "\n")
      : Response.json({ message: { content: "Synthetic answer." } });
    assert.ok(url.endsWith("/chat/completions"));
    if (body.stream) return new Response('data: {"choices":[{"delta":{"content":"Synthetic answer."}}]}\n\ndata: [DONE]\n\n');
    const content = body.model === "fixture-judge" ? JSON.stringify({ claims: [{ claim: "Synthetic answer.", evidence: "Synthetic evidence passage." }] }) : "Synthetic answer.";
    return Response.json({ choices: [{ message: { content }, finish_reason: "stop" }] });
  });
  t.mock.method(BedrockRuntimeClient.prototype, "send", async (command: unknown, options?: { abortSignal?: AbortSignal }) => {
    sdkCalls++; assert.ok(options?.abortSignal);
    if (command instanceof InvokeModelCommand) return { body: Buffer.from(JSON.stringify({ embedding: [1, 0] })) };
    if (command instanceof ConverseStreamCommand) return { stream: (async function* () {
      yield { contentBlockDelta: { delta: { text: "Synthetic answer." } } }; yield { messageStop: { stopReason: "end_turn" } };
    })() };
    return { output: { message: { content: [{ text: "Synthetic answer." }] } } };
  });
  const settings = parseRuntimeConfiguration({ PROVIDER_TIMEOUT_MS: "1234", OPENROUTER_API_KEY: "synthetic-key", RERANKER_PROVIDER: "jina", JINA_API_KEY: "synthetic-key" });
  const { registry } = createConfiguredProviderBindings(settings);
  for (const provider of ["ollama", "openrouter", "bedrock"] as const) {
    const answer = registry.createAnswer({ provider, model: "fixture-answer", maxOutputTokens: 50 });
    assert.equal(await answer.generate("Synthetic question?", "Synthetic evidence passage."), "Synthetic answer.");
    const chunks: string[] = [];
    assert.ok(answer.stream);
    assert.equal(await answer.stream("Synthetic question?", "Synthetic evidence passage.", (text) => { chunks.push(text); }), "Synthetic answer.");
    assert.deepEqual(chunks, ["Synthetic answer."]);
    assert.deepEqual(await registry.createEmbedding({ provider, model: "fixture-embedding", dimensions: 2 }).embed("Synthetic text.", "query"), [1, 0]);
  }
  const judge = registry.createJudge({ provider: "openrouter", model: "fixture-judge" }); assert.ok(judge);
  assert.equal((await judge.assess({ answer: "Synthetic answer.", passages: ["Synthetic evidence passage."] }, new AbortController().signal)).length, 1);
  await registry.createReranker().rerank({ query: "Synthetic question?", limit: 1, candidates: [{ chunkId: "c", documentId: "d", ordinal: 0,
    content: "Synthetic evidence passage.", source: "synthetic", title: null, score: 0.8, security: { promptInjectionRisk: "low", signals: [] } }] });
  assert.deepEqual(observed, Array(11).fill(1234)); assert.equal(httpCalls, 8); assert.equal(sdkCalls, 3);
  const other = createConfiguredProviderBindings(parseRuntimeConfiguration({ PROVIDER_TIMEOUT_MS: "5000" }));
  await other.registry.createEmbedding({ provider: "ollama", model: "fixture", dimensions: 2 }).embed("Synthetic text.", "query");
  assert.equal(observed.at(-1), 5000); assert.equal(observed[0], 1234);
});
