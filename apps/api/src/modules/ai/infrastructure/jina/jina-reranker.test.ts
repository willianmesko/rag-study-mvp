import assert from "node:assert/strict";
import test from "node:test";
import { JinaReranker } from "./jina-reranker.js";

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
