import assert from "node:assert/strict";
import test from "node:test";
import { LangGraphRagWorkflow } from "./langgraph-rag-workflow.js";
import { GroundedClaimVerifier } from "../../application/policies/claim-verification.js";
import {
  WorkflowEmbeddingProvider,
  WorkflowAnswerGenerator,
} from "../security/workflow-provider-guards.js";
import { withTransientBudget } from "../../application/workflows/transient-budget.js";
import type { RetrievedChunk } from "../../domain/document.js";
const passage: RetrievedChunk = {
  chunkId: "chunk",
  documentId: "doc",
  source: "handbook",
  title: null,
  ordinal: 0,
  score: 0.9,
  content: "RAG combines retrieval with answer generation.",
  security: { promptInjectionRisk: "low", signals: [] },
};
const output = (answer: string, ids = ["S1"]) =>
  JSON.stringify({ answer, citedChunkIds: ids });
const options = {
  maxContextChars: 2000,
  minimumScore: 0.3,
  claimVerifier: new GroundedClaimVerifier(),
};
test("weak relevance triggers exactly one rewrite with a fresh embedding", async () => {
  const requests: Parameters<
    ConstructorParameters<typeof LangGraphRagWorkflow>[0]["execute"]
  >[0][] = [];
  const rag = new LangGraphRagWorkflow(
    {
      execute: async (input) => {
        requests.push(input);
        return requests.length === 1 ? [] : [passage];
      },
    },
    { generate: async () => output(passage.content) },
    options,
  );
  const result = await rag.answer({
    question: "What is RAG?",
    queryEmbedding: [1, 0],
    embeddingIndexVersion: "v1",
  });
  assert.equal(result.retrievalAttempts, 2);
  assert.equal(result.refusalReason, undefined);
  assert.equal(requests[1]?.query, "RAG");
  assert.equal(requests[1]?.queryEmbedding, undefined);
  assert.equal(requests[1]?.embeddingIndexVersion, "v1");
  assert.equal(requests.length, 2);
});
test("invalid citations get one repair and no rejected answer is streamed", async () => {
  let calls = 0;
  const deltas: string[] = [];
  const rag = new LangGraphRagWorkflow(
    { execute: async () => [passage] },
    {
      generate: async (_q, _c, _s, _u, _p, _v, controls) => {
        calls++;
        if (calls === 1) return output("Unsupported draft.", ["S99"]);
        assert.equal(controls?.repair?.reason, "invalid_citations");
        return output(passage.content);
      },
    },
    options,
  );
  const result = await rag.answerStream(
    { question: "What is RAG?" },
    (event) => {
      if (event.type === "token") deltas.push(event.delta);
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.repaired, true);
  assert.equal(deltas.join(""), passage.content);
});
test("unsupported claims stop after one repair without releasing answer text", async () => {
  let calls = 0;
  const events: string[] = [];
  const rag = new LangGraphRagWorkflow(
    { execute: async () => [passage] },
    {
      generate: async () => {
        calls++;
        return output("RAG always guarantees factual accuracy.");
      },
    },
    options,
  );
  const result = await rag.answerStream(
    { question: "What is RAG?" },
    (event) => {
      events.push(event.type);
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.refusalReason, "unverified_claims");
  assert.deepEqual(result.sources, []);
  assert.ok(!events.includes("token"));
  assert.ok(!events.includes("citations"));
});
test("embedding reservations are atomic across concurrent calls and abort reaches provider", async () => {
  let calls = 0;
  const provider = new WorkflowEmbeddingProvider(
    {
      embed: async () => {
        calls++;
        return [1, 0];
      },
    },
    "fixture",
    2,
    0,
  );
  const budget = {
    maxSteps: 10,
    maxCalls: 1,
    maxInputTokens: 1000,
    maxOutputTokens: 0,
    maxCostMicros: 0,
    timeoutMs: 1000,
  };
  await withTransientBudget(budget, async () => {
    const results = await Promise.allSettled([
      provider.embed("first", "query"),
      provider.embed("second", "query"),
    ]);
    assert.equal(
      results.filter(({ status }) => status === "rejected").length,
      1,
    );
  });
  assert.equal(calls, 1);
  const controller = new AbortController();
  let stopped = false;
  const waiting = new WorkflowEmbeddingProvider(
    {
      embed: async (_t, _k, signal) =>
        new Promise<number[]>((_, reject) => {
          signal!.addEventListener(
            "abort",
            () => {
              stopped = true;
              reject(signal!.reason);
            },
            { once: true },
          );
        }),
    },
    "fixture",
    2,
    0,
  );
  const pending = waiting.embed("text", "query", controller.signal);
  controller.abort();
  await assert.rejects(pending);
  assert.equal(stopped, true);
});
test("a model request is blocked before the provider when its reservation exceeds budget", async () => {
  let calls = 0;
  const generator = new WorkflowAnswerGenerator(
    {
      generate: async () => {
        calls++;
        return "unsafe";
      },
    },
    "fixture",
    { inputCostPer1kUsd: 1, outputCostPer1kUsd: 1 },
    100,
  );
  await assert.rejects(
    withTransientBudget(
      {
        maxSteps: 10,
        maxCalls: 10,
        maxInputTokens: 100_000,
        maxOutputTokens: 100,
        maxCostMicros: 1,
        timeoutMs: 1000,
      },
      () => generator.generate("question", "passage"),
    ),
    /budget_exceeded/,
  );
  assert.equal(calls, 0);
});
