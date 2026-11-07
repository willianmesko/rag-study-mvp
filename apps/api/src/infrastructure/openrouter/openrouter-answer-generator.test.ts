import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import test, { type TestContext } from "node:test";
import { OpenRouterAnswerGenerator } from "./openrouter-answer-generator.js";

function chunk(content: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

async function fakeProvider(context: TestContext, handleRequest: RequestListener) {
  const server = createServer(handleRequest);
  context.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return new OpenRouterAnswerGenerator(`http://127.0.0.1:${address.port}`, "fixture-key", "fixture-model");
}

test("cancelling an OpenRouter stream closes its provider connection", { timeout: 5_000 }, async (context) => {
  let markClosed!: () => void;
  const connectionClosed = new Promise<void>((resolve) => { markClosed = resolve; });
  const provider = await fakeProvider(context, (_request, response) => {
    response.once("close", markClosed);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(chunk("partial"));
  });
  const controller = new AbortController();
  await assert.rejects(provider.stream("Question", "Context", (delta) => {
    assert.equal(delta, "partial");
    controller.abort();
  }, controller.signal), { name: "AbortError" });
  await connectionClosed;
});

test("OpenRouter rejects an interrupted stream even if answer text already arrived", async (context) => {
  const provider = await fakeProvider(context, (_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(chunk("partial"));
  });
  await assert.rejects(provider.stream("Question", "Context", () => undefined), /closed the stream/);
});

test("OpenRouter accepts completed streams and rejects mid-stream provider errors", async (context) => {
  let requests = 0;
  const provider = await fakeProvider(context, (_request, response) => {
    requests += 1;
    response.writeHead(200, { "content-type": "text/event-stream" });
    const end = requests === 1 ? ": PROCESSING\n\ndata: [DONE]\n\n"
      : 'data: {"error":{"message":"unavailable"},"choices":[{"finish_reason":"error"}]}\n\n';
    response.end(chunk("an answer") + end);
  });
  assert.equal(await provider.stream("Question", "Context", () => undefined), "an answer");
  await assert.rejects(provider.stream("Question", "Context", () => undefined), /could not finish streaming/);
});
