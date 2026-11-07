import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterEmbeddingProvider } from "../openrouter/openrouter-embedding-provider.js";
import { OllamaEmbeddingProvider } from "../ollama/ollama-embedding-provider.js";
import { TitanEmbeddingProvider } from "../bedrock/titan-embedding-provider.js";
import { OpenRouterFaithfulnessJudge } from "../openrouter/openrouter-faithfulness-judge.js";
import { JinaReranker } from "../jina/jina-reranker.js";
import type { ProviderTokenUsage } from "../../application/ports/answer-generator.js";
import type { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

test("embedding, reranking and judge adapters publish native tokens without inventing dollar prices", async (t) => {
  let payload: unknown = {
    data: [{ embedding: [1, 0] }],
    usage: { prompt_tokens: 7, cost: 0 },
  };
  t.mock.method(globalThis, "fetch", async () => Response.json(payload));
  const usage: ProviderTokenUsage[] = [],
    observe = (value: ProviderTokenUsage) => {
      usage.push(value);
    };
  const embedding = new OpenRouterEmbeddingProvider(
    "https://fixture.example.com",
    "fixture-key",
    "embedding",
    2,
  );
  await embedding.embed("private text", "document", undefined, observe);
  assert.deepEqual(usage.pop(), {
    inputTokens: 7,
    outputTokens: 0,
    costUsd: 0,
  });
  payload = {
    data: [{ embedding: [1, 0] }],
    usage: { prompt_tokens: 8, cost: null },
  };
  await embedding.embed("private text", "query", undefined, observe);
  assert.deepEqual(usage.pop(), { inputTokens: 8, outputTokens: 0 });
  payload = { embeddings: [[1, 0]], prompt_eval_count: 12 };
  await new OllamaEmbeddingProvider("http://localhost:11434", "local", 2).embed(
    "private",
    "query",
    undefined,
    observe,
  );
  assert.deepEqual(usage.pop(), { inputTokens: 12, outputTokens: 0 });
  const client = {
    send: async () => ({
      body: Buffer.from(
        JSON.stringify({ embedding: [1, 0], inputTextTokenCount: 13 }),
      ),
    }),
  } as unknown as BedrockRuntimeClient;
  await new TitanEmbeddingProvider(client, "fixture", 2).embed(
    "private",
    "query",
    undefined,
    observe,
  );
  assert.deepEqual(usage.pop(), { inputTokens: 13, outputTokens: 0 });
  payload = {
    results: [{ index: 0, relevance_score: 0.9 }],
    usage: { total_tokens: 27 },
  };
  await new JinaReranker(
    "https://fixture.example.com",
    "key",
    "reranker",
  ).rerank({
    query: "private",
    limit: 1,
    onUsage: observe,
    candidates: [
      {
        chunkId: "c",
        documentId: "d",
        ordinal: 0,
        content: "Source passage",
        source: "s",
        title: null,
        score: 0.8,
        security: { promptInjectionRisk: "low", signals: [] },
      },
    ],
  });
  assert.deepEqual(usage.pop(), { inputTokens: 27, outputTokens: 0 });
  payload = {
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            claims: [
              {
                claim: "A bounded claim.",
                evidence: "Supporting passage text.",
              },
            ],
          }),
        },
      },
    ],
    usage: { prompt_tokens: 40, completion_tokens: 14, cost: 0.0001 },
  };
  const judge = new OpenRouterFaithfulnessJudge(
    "https://fixture.example.com",
    "key",
    "judge",
  );
  await judge.assess(
    { answer: "A bounded claim.", passages: ["Supporting passage text."] },
    new AbortController().signal,
    observe,
  );
  assert.deepEqual(usage.pop(), {
    inputTokens: 40,
    outputTokens: 14,
    costUsd: 0.0001,
  });
  payload = {
    choices: [
      {
        finish_reason: "length",
        message: { content: "invalid truncated output" },
      },
    ],
    usage: { prompt_tokens: 40, completion_tokens: 900, cost: 0.001 },
  };
  await assert.rejects(
    judge.assess(
      { answer: "private", passages: [] },
      new AbortController().signal,
      observe,
    ),
  );
  assert.equal(
    usage.pop()?.costUsd,
    0.001,
    "usage survives invalid paid verdicts",
  );
});
