import assert from "node:assert/strict";
import test from "node:test";
import { JinaReranker } from "./jina-reranker.js";
import type { RetrievedChunk } from "../../../knowledge/index.js";
import type { ProviderTokenUsage } from "../../application/ports/answer-generator.js";
import { IntegrationFailure } from "../../../../platform/integrations/retry-policy.js";
import { defaultProviderHttpClient } from "../../../../platform/http/provider-client.js";

test("Jina reranker masks identifiers in requests and maps ordered indexes to original chunks", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = async (_url, init) => {
    requestBody = String(init?.body);
    return new Response(JSON.stringify({
      results: [{ index: 1, relevance_score: 0.93 }, { index: 0, relevance_score: 0.42 }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const reranker = new JinaReranker("https://api.example.test/v1", "test-key", "test-model");
    const result = await reranker.rerank({
      query: "Which chunk mentions customer@example.test?",
      limit: 2,
      candidates: [
        { chunkId: "first", documentId: "d", ordinal: 0, content: "first content", source: "s", title: null, score: 0.7, security: { promptInjectionRisk: "low", signals: [] } },
        { chunkId: "second", documentId: "d", ordinal: 1, content: "Contact author@example.test for the second passage.", source: "s", title: null, score: 0.6, security: { promptInjectionRisk: "low", signals: [] } }
      ]
    });

    const payload = JSON.parse(requestBody);
    assert.equal(payload.top_n, 2);
    assert.equal(payload.query, "Which chunk mentions [REDACTED_EMAIL]?");
    assert.deepEqual(payload.documents, ["first content", "Contact [REDACTED_EMAIL] for the second passage."]);
    assert.deepEqual(result.map((chunk) => [chunk.chunkId, chunk.reranker?.rank]), [["second", 1], ["first", 2]]);
    assert.equal(result[0]?.content, "Contact author@example.test for the second passage.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const candidates: RetrievedChunk[] = [0, 1].map((ordinal) => ({ chunkId: `synthetic-${ordinal}`, documentId: "synthetic-document",
  ordinal, content: "Synthetic passage.", source: "synthetic/source", title: null, score: 0.8,
  security: { promptInjectionRisk: "low", signals: [] } }));
function safeFailure(error: unknown) {
  assert.ok(error instanceof IntegrationFailure); assert.equal(error.code, "invalid_response");
  assert.equal(error.cause, undefined); assert.doesNotMatch(error.message, /PRIVATE_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(error), /PRIVATE_SENTINEL/); return true;
}

test("Jina rejects invalid envelopes, excess results, indexes and scores with fixed safe errors", async (t) => {
  let payload: unknown, calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json(payload); });
  const reranker = new JinaReranker("https://synthetic.example", "synthetic-key", "synthetic-model");
  const result = { index: 0, relevance_score: 0.8 };
  const invalid = [null, [], {}, { results: "PRIVATE_SENTINEL" }, { results: [null] },
    { results: [result, result] }, { results: [{ ...result, index: 2 }] }, { results: [{ ...result, index: -1 }] },
    { results: [{ ...result, relevance_score: "PRIVATE_SENTINEL" }] }, { results: [{ ...result, relevance_score: null }] }];
  for (payload of invalid) await assert.rejects(reranker.rerank({ query: "Synthetic?", candidates, limit: 2 }), safeFailure);
  payload = { results: [result, { ...result, index: 1 }] };
  await assert.rejects(reranker.rerank({ query: "Synthetic?", candidates, limit: 1 }), safeFailure);
  assert.equal(calls, invalid.length + 1);
});

test("Jina retains native zero usage and invalid-output receipts while returning only original server passages", async (t) => {
  let score: unknown = 0.8;
  t.mock.method(globalThis, "fetch", async () => Response.json({ results: [{ index: 0, relevance_score: score, document: { text: "PRIVATE_SENTINEL" } }], usage: { total_tokens: 0 } }));
  const reranker = new JinaReranker("https://synthetic.example", "synthetic-key", "synthetic-model"), observed: ProviderTokenUsage[] = [];
  const onUsage = (value: ProviderTokenUsage) => { observed.push(value); };
  const result = await reranker.rerank({ query: "Synthetic?", candidates, limit: 1, onUsage });
  assert.equal(result[0]?.content, candidates[0]?.content);
  assert.equal(result[0]?.reranker?.score, 0.8);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
  score = "PRIVATE_SENTINEL";
  await assert.rejects(reranker.rerank({ query: "Synthetic?", candidates, limit: 1, onUsage }), safeFailure);
  assert.deepEqual(observed, Array(2).fill({ inputTokens: 0, outputTokens: 0 }));
});

test("Jina bounds array traversal and rejects invalid internal limits before an outbound request", async () => {
  let calls = 0;
  const oversized = new Proxy(Array(3), { get(target, key, receiver) {
    if (key === "0") assert.fail("Excess result items must not be traversed.");
    return Reflect.get(target, key, receiver);
  } });
  const reranker = new JinaReranker("https://synthetic.example", "synthetic-key", "synthetic-model", {
    ...defaultProviderHttpClient, requestJson: async () => { calls++; return { results: oversized }; }
  });
  for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    await assert.rejects(reranker.rerank({ query: "Synthetic?", candidates, limit }), /positive integer/);
  assert.equal(calls, 0);
  assert.deepEqual(await reranker.rerank({ query: "Synthetic?", candidates: [], limit: 0 }), []);
  assert.equal(calls, 0);
  await assert.rejects(reranker.rerank({ query: "Synthetic?", candidates, limit: 2 }), safeFailure);
  assert.equal(calls, 1);
});

test("Jina preserves empty results and does not fabricate malformed native usage", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ results: [], usage: { total_tokens: "0" } }));
  const observed: ProviderTokenUsage[] = [], reranker = new JinaReranker("https://synthetic.example", "synthetic-key", "synthetic-model");
  assert.deepEqual(await reranker.rerank({ query: "Synthetic?", candidates, limit: 2, onUsage: (value) => observed.push(value) }), []);
  assert.deepEqual(observed, []);
});
