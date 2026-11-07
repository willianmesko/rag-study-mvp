import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterFaithfulnessJudge } from "./openrouter-faithfulness-judge.js";

test("the OpenRouter faithfulness judge requests strict bounded verdicts and validates the result", async (t) => {
  const judge = new OpenRouterFaithfulnessJudge("https://judge.example.test/api/v1", "fixture-key", "fixture/judge");
  const input = { answer: "The archive opens on Monday.", passages: ["The archive opens on Monday."] };
  const response = { claims: [{ claim: "The archive opens on Monday.", evidence: "The archive opens on Monday." }] };
  let finishReason = "stop";
  t.mock.method(globalThis, "fetch", async (url: string, request: RequestInit) => {
    assert.equal(url, "https://judge.example.test/api/v1/chat/completions");
    assert.equal(new Headers(request.headers).get("authorization"), "Bearer fixture-key");
    assert.ok(request.signal);
    const body = JSON.parse(String(request.body));
    assert.equal(body.model, "fixture/judge");
    assert.equal(body.max_tokens, 900);
    assert.equal(body.temperature, 0);
    assert.equal(body.provider.require_parameters, true);
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(JSON.parse(body.messages[1].content), input);
    assert.doesNotMatch(JSON.stringify(body), /fixture-key/);
    return Response.json({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(response) } }] });
  });

  assert.deepEqual(await judge.assess(input, new AbortController().signal), response.claims);
  finishReason = "length";
  await assert.rejects(judge.assess(input, new AbortController().signal));
});
