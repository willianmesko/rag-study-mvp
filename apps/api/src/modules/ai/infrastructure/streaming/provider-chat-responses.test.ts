import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import type { ProviderTokenUsage } from "../../application/ports/answer-generator.js";
import { defaultProviderHttpClient, type ProviderHttpClient } from "../../../../platform/http/provider-client.js";
import { IntegrationFailure } from "../../../../platform/integrations/retry-policy.js";
import { OpenRouterAnswerGenerator } from "../openrouter/openrouter-answer-generator.js";
import { OllamaAnswerGenerator } from "../ollama/ollama-answer-generator.js";

type Vendor = "openrouter" | "ollama";
const event = (vendor: Vendor, value: unknown) => `${vendor === "openrouter" ? "data: " : ""}${JSON.stringify(value)}\r\n${vendor === "openrouter" ? "\r\n" : ""}`;
const terminal = (vendor: Vendor) => vendor === "openrouter" ? "data: [DONE]\r\n\r\n" : "";
const content = (vendor: Vendor, text: unknown) => vendor === "openrouter"
  ? { choices: [{ delta: { content: text }, finish_reason: null }] }
  : { done: false, message: { content: text } };
function response(wire: string, close = true, chunkSize = 3) {
  let cancelled = false;
  const bytes = new TextEncoder().encode(wire);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize));
      if (close) controller.close();
    },
    cancel() { cancelled = true; }
  });
  return { body: new Response(body), cancelled: () => cancelled };
}
function adapter(vendor: Vendor, input: { json?: unknown; response?: Response }) {
  const http: ProviderHttpClient = {
    signal: defaultProviderHttpClient.signal,
    requestJson: async () => input.json,
    requestResponse: async () => { assert.ok(input.response); return input.response; }
  };
  return vendor === "openrouter" ? new OpenRouterAnswerGenerator("https://synthetic.example", "synthetic-key", "synthetic-model", 50, http)
    : new OllamaAnswerGenerator("https://synthetic.example", "synthetic-model", 50, http);
}
function safeFailure(error: unknown) {
  assert.ok(error instanceof IntegrationFailure);
  assert.equal(error.code, "invalid_response");
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(error.message, /PRIVATE_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(error), /PRIVATE_SENTINEL/);
  return true;
}
const usage = (vendor: Vendor) => vendor === "openrouter"
  ? { usage: { prompt_tokens: 0, completion_tokens: 0, cost: 0 } }
  : { prompt_eval_count: 0, eval_count: 0 };
const expectedUsage = (vendor: Vendor) => ({ inputTokens: 0, outputTokens: 0, ...(vendor === "openrouter" ? { costUsd: 0 } : {}) });

for (const vendor of ["openrouter", "ollama"] as const) {
  test(`${vendor} retains split UTF-8, metadata, final accounting and completion behavior`, async () => {
    const observations: ProviderTokenUsage[] = [], deltas: string[] = [];
    const metadata = vendor === "openrouter" ? ": PROCESSING\r\n\r\n" + event(vendor, { choices: [{ delta: { role: "assistant", content: null }, finish_reason: null }], id: "synthetic-id" })
      : event(vendor, { done: false, message: { role: "assistant", content: "" } });
    const end = vendor === "openrouter" ? event(vendor, { choices: [{ delta: { content: "" }, finish_reason: "stop" }] }) +
      event(vendor, { choices: [{ delta: { content: "" }, finish_reason: "stop" }], ...usage(vendor) }) + terminal(vendor)
      : event(vendor, { done: true, message: { content: "" }, ...usage(vendor) });
    const wire = metadata + event(vendor, content(vendor, "Olá ")) + event(vendor, content(vendor, "answer.")) + end;
    assert.equal(await adapter(vendor, { response: response(wire).body }).stream("Synthetic question", "Synthetic context",
      (text) => { deltas.push(text); }, undefined, (value) => observations.push(value)), "Olá answer.");
    assert.deepEqual(deltas, ["Olá ", "answer."]);
    assert.deepEqual(observations, [expectedUsage(vendor)]);
  });

  test(`${vendor} rejects malformed frames before forwarding their contents and cleans up the reader`, async () => {
    const invalid: unknown[] = [null, [], false, "PRIVATE_SENTINEL", content(vendor, 7), content(vendor, { PRIVATE_SENTINEL: true }),
      vendor === "openrouter" ? { choices: [{ delta: { content: "PRIVATE_SENTINEL" } }, { delta: { content: "extra" } }] } : { done: "true", message: { content: "PRIVATE_SENTINEL" } },
      vendor === "openrouter" ? { choices: [{ delta: null }] } : { done: true, message: null },
      vendor === "openrouter" ? { choices: [{ finish_reason: 7 }] } : { done: true, response: [] }];
    for (const value of invalid) {
      const upstream = response(event(vendor, value) + terminal(vendor), false, 65_536);
      let forwarded = false;
      await assert.rejects(adapter(vendor, { response: upstream.body }).stream("Synthetic question", "Synthetic context", () => { forwarded = true; }), safeFailure);
      assert.equal(forwarded, false); assert.equal(upstream.cancelled(), true);
    }
    const brokenJson = response(`${vendor === "openrouter" ? "data: " : ""}{"PRIVATE_SENTINEL":\n\n`, false);
    await assert.rejects(adapter(vendor, { response: brokenJson.body }).stream("Synthetic question", "Synthetic context", () => assert.fail("Malformed JSON must not reach the callback.")), safeFailure);
    assert.equal(brokenJson.cancelled(), true);
  });

  test(`${vendor} retains valid native usage on malformed JSON-answer and terminal-stream content`, async () => {
    const observations: ProviderTokenUsage[] = [];
    const json = vendor === "openrouter" ? { choices: [{ message: { content: { PRIVATE_SENTINEL: true } } }], ...usage(vendor) }
      : { message: { content: { PRIVATE_SENTINEL: true } }, ...usage(vendor) };
    await assert.rejects(adapter(vendor, { json }).generate("Synthetic question", "Synthetic context", undefined, (value) => observations.push(value)), safeFailure);
    const frame = { ...content(vendor, { PRIVATE_SENTINEL: true }), ...(vendor === "ollama" ? { done: true } : {}), ...usage(vendor) };
    await assert.rejects(adapter(vendor, { response: response(event(vendor, frame) + terminal(vendor)).body })
      .stream("Synthetic question", "Synthetic context", () => assert.fail("Malformed delta must not be published."), undefined, (value) => observations.push(value)), safeFailure);
    assert.deepEqual(observations, [expectedUsage(vendor), expectedUsage(vendor)]);
  });

  test(`${vendor} rejects bad JSON-answer envelopes while leaving malformed usage unknown`, async () => {
    for (const json of [null, [], {}, vendor === "openrouter" ? { choices: [] } : { message: null },
      vendor === "openrouter" ? { choices: [{ message: { content: "PRIVATE_SENTINEL" } }, { message: { content: "second" } }] } : { message: { content: 9 } }])
      await assert.rejects(adapter(vendor, { json }).generate("Synthetic question", "Synthetic context"), safeFailure);
    const observations: ProviderTokenUsage[] = [];
    const json = vendor === "openrouter" ? { choices: [{ message: { content: " Answer. " } }], usage: { prompt_tokens: "0", completion_tokens: 0 } }
      : { message: { content: " Answer. " }, prompt_eval_count: null, eval_count: 0 };
    assert.equal(await adapter(vendor, { json }).generate("Synthetic question", "Synthetic context", undefined, (value) => observations.push(value)), "Answer.");
    assert.deepEqual(observations, []);
  });

  test(`${vendor} keeps incomplete streams and callback failures from becoming completed answers`, async () => {
    const incomplete = response(event(vendor, content(vendor, "Partial")));
    await assert.rejects(adapter(vendor, { response: incomplete.body }).stream("Synthetic question", "Synthetic context", () => undefined), /closed the stream/);
    const upstream = response(event(vendor, content(vendor, "Partial")), false, 65_536);
    const failure = new Error("Synthetic callback stopped.");
    await assert.rejects(adapter(vendor, { response: upstream.body }).stream("Synthetic question", "Synthetic context", () => { throw failure; }), (error) => error === failure);
    assert.equal(upstream.cancelled(), true);
  });

  test(`${vendor} handles provider errors without forwarding or retaining their details`, async () => {
    const upstream = response(event(vendor, { error: { message: "PRIVATE_SENTINEL" } }), false, 65_536);
    await assert.rejects(adapter(vendor, { response: upstream.body }).stream("Synthetic question", "Synthetic context", () => assert.fail("Provider errors are not answer text.")), (error) => {
      assert.ok(error instanceof Error); assert.match(error.message, /could not finish streaming/);
      assert.doesNotMatch(error.message, /PRIVATE_SENTINEL/); assert.equal(error.cause, undefined); return true;
    });
    assert.equal(upstream.cancelled(), true);
  });

  test(`${vendor} caller cancellation closes a real loopback provider connection`, { timeout: 5_000 }, async (context) => {
    let markClosed!: () => void;
    const closed = new Promise<void>((resolve) => { markClosed = resolve; });
    const server = createServer((_request, output) => {
      output.once("close", markClosed);
      output.writeHead(200, { "content-type": vendor === "openrouter" ? "text/event-stream" : "application/x-ndjson" });
      output.write(event(vendor, content(vendor, "Partial")));
    });
    context.after(() => { server.closeAllConnections(); return new Promise<void>((resolve) => server.close(() => resolve())); });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const provider = vendor === "openrouter" ? new OpenRouterAnswerGenerator(baseUrl, "synthetic-key", "synthetic-model")
      : new OllamaAnswerGenerator(baseUrl, "synthetic-model");
    const controller = new AbortController();
    await assert.rejects(provider.stream("Synthetic question", "Synthetic context", (text) => {
      assert.equal(text, "Partial"); controller.abort();
    }, controller.signal), { name: "AbortError" });
    await closed;
  });
}

test("OpenRouter keeps empty-choice accounting frames and Ollama keeps its existing response fallback", async () => {
  const observations: ProviderTokenUsage[] = [];
  const wire = event("openrouter", content("openrouter", "Answer.")) + event("openrouter", { choices: [], ...usage("openrouter") }) + terminal("openrouter");
  assert.equal(await adapter("openrouter", { response: response(wire).body }).stream("Synthetic question", "Synthetic context", () => undefined, undefined, (value) => observations.push(value)), "Answer.");
  assert.deepEqual(observations, [expectedUsage("openrouter")]);
  assert.equal(await adapter("ollama", { response: response(event("ollama", { done: true, response: "Answer." })).body })
    .stream("Synthetic question", "Synthetic context", () => undefined), "Answer.");
});
