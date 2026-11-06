import assert from "node:assert/strict";
import test from "node:test";
import { JinaReranker } from "./jina-reranker.js";

test("Jina reranker maps ordered provider indexes back to retrieved chunks", async () => {
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
      query: "Which chunk is relevant?",
      limit: 2,
      candidates: [
        { chunkId: "first", documentId: "d", ordinal: 0, content: "first content", source: "s", title: null, score: 0.7, security: { promptInjectionRisk: "low", signals: [] } },
        { chunkId: "second", documentId: "d", ordinal: 1, content: "second content", source: "s", title: null, score: 0.6, security: { promptInjectionRisk: "low", signals: [] } }
      ]
    });

    assert.match(requestBody, /"top_n":2/);
    assert.deepEqual(result.map((chunk) => [chunk.chunkId, chunk.reranker?.rank]), [["second", 1], ["first", 2]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
