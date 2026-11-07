import assert from "node:assert/strict";
import test from "node:test";
import type { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import type { ProviderTokenUsage } from "../../application/ports/answer-generator.js";
import { IntegrationFailure } from "../../../../platform/integrations/retry-policy.js";
import { decodeEmbeddingVector } from "./embedding-response.js";
import { OpenRouterEmbeddingProvider } from "../openrouter/openrouter-embedding-provider.js";
import { OllamaEmbeddingProvider } from "../ollama/ollama-embedding-provider.js";
import { maxProviderResponseBytes } from "../../../../platform/http/provider-client.js";
import { TitanEmbeddingProvider } from "../bedrock/titan-embedding-provider.js";

function adapter(body: unknown) {
  const client = { send: async () => ({ body }) } as unknown as BedrockRuntimeClient;
  return new TitanEmbeddingProvider(client, "synthetic-model", 2);
}
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
function safeFailure(error: unknown) {
  assert.ok(error instanceof IntegrationFailure); assert.equal(error.code, "invalid_response");
  assert.ok(!error.message.includes("PRIVATE_SENTINEL")); assert.equal(error.cause, undefined); return true;
}

test("Titan returns only finite vectors of the configured size and preserves native zero usage", async () => {
  for (const tokens of [0, 7]) {
    const usage: ProviderTokenUsage[] = [];
    const result = await adapter(encode({ embedding: [0.25, -0.75], inputTextTokenCount: tokens, embeddingsByType: { float: [0.25, -0.75] } }))
      .embed("Synthetic input.", "query", undefined, (value) => usage.push(value));
    assert.deepEqual(result, [0.25, -0.75]); assert.deepEqual(usage, [{ inputTokens: tokens, outputTokens: 0 }]);
  }
});

test("Titan rejects malformed JSON, strings, objects, non-finite values and wrong dimensions without reflecting bodies", async () => {
  const bodies = [undefined, Buffer.from('{"PRIVATE_SENTINEL":'), encode(null), encode({ embedding: "xx", detail: "PRIVATE_SENTINEL" }),
    encode({ embedding: { length: 2 } }), encode({ embedding: ["0.5", 0] }), encode({ embedding: [0.5] }),
    encode({ embedding: [0, null] }), Buffer.from('{"embedding":[1e400,0]}'), encode({ error: "PRIVATE_SENTINEL" })];
  for (const body of bodies) await assert.rejects(adapter(body).embed("Synthetic input.", "query"), safeFailure);
});

test("native usage survives a bad vector, while malformed usage is not fabricated into zero", async () => {
  const observed: ProviderTokenUsage[] = [];
  await assert.rejects(adapter(encode({ embedding: "xx", inputTextTokenCount: 8 })).embed("Synthetic input.", "query", undefined, (value) => observed.push(value)), safeFailure);
  assert.deepEqual(observed, [{ inputTokens: 8, outputTokens: 0 }]); observed.length = 0;
  for (const count of [undefined, null, "8", -1, 1.5, 2_147_483_648]) {
    assert.deepEqual(await adapter(encode({ embedding: [1, 0], inputTextTokenCount: count })).embed("Synthetic input.", "query", undefined, (value) => observed.push(value)), [1, 0]);
  }
  assert.deepEqual(observed, []);
});

test("oversized SDK response bodies are rejected before text decoding", async (t) => {
  t.mock.method(TextDecoder.prototype, "decode", () => { assert.fail("Oversized response must not reach text decoding."); });
  await assert.rejects(adapter(Buffer.alloc(maxProviderResponseBytes + 1)).embed("Synthetic input.", "query"), safeFailure);
});

test("vector length is checked before inspecting any element of an oversized response", () => {
  const oversized = new Proxy(Array(3), { get(target, key, receiver) {
    if (key === "0") assert.fail("Oversized vector elements must not be inspected.");
    return Reflect.get(target, key, receiver);
  } });
  assert.throws(() => decodeEmbeddingVector(oversized, 2), safeFailure);
  assert.throws(() => decodeEmbeddingVector([], 0), safeFailure);
});

for (const vendor of ["openrouter", "ollama"] as const) {
  test(`${vendor} decodes one finite vector and rejects malformed or unexpected batches`, async (t) => {
    let payload: unknown;
    t.mock.method(globalThis, "fetch", async () => Response.json(payload));
    const provider = vendor === "openrouter" ? new OpenRouterEmbeddingProvider("https://synthetic.example", "synthetic-key", "synthetic", 2)
      : new OllamaEmbeddingProvider("https://synthetic.example", "synthetic", 2);
    const response = (vector: unknown, tokens: unknown = 7) => vendor === "openrouter"
      ? { data: [{ embedding: vector }], usage: { prompt_tokens: tokens, cost: 0 } }
      : { embeddings: [vector], prompt_eval_count: tokens };
    const observed: ProviderTokenUsage[] = [];
    payload = response([1, 0], 0);
    assert.deepEqual(await provider.embed("Synthetic input.", "query", undefined, (value) => observed.push(value)), [1, 0]);
    assert.deepEqual(observed[0], { inputTokens: 0, outputTokens: 0, ...(vendor === "openrouter" ? { costUsd: 0 } : {}) });
    for (const vector of ["xx", { length: 2 }, ["1", 0], [null, 0], [1], [1, 0, 0]]) {
      payload = response(vector); await assert.rejects(provider.embed("Synthetic input.", "query"), safeFailure);
    }
    for (const invalid of [null, {}, vendor === "openrouter" ? { data: [] } : { embeddings: [] },
      vendor === "openrouter" ? { data: [{ embedding: [1, 0] }, { embedding: [1, 0] }] } : { embeddings: [[1, 0], [1, 0]] }]) {
      payload = invalid; await assert.rejects(provider.embed("Synthetic input.", "query"), safeFailure);
    }
    observed.length = 0; payload = response("xx", 8);
    await assert.rejects(provider.embed("Synthetic input.", "query", undefined, (value) => observed.push(value)), safeFailure);
    assert.equal(observed[0]?.inputTokens, 8, "valid usage remains measurable on a failed output");
  });
}
