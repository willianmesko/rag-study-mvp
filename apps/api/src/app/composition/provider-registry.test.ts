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
