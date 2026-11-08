import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterFaithfulnessJudge } from "./openrouter-faithfulness-judge.js";
import { IntegrationFailure } from "../../../../platform/integrations/retry-policy.js";
import type { ProviderTokenUsage } from "../../application/ports/answer-generator.js";

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

const verdict = { claims: [{ claim: "The archive opens on Monday.", evidence: "The archive opens on Monday." }] };
const input = { answer: "The archive opens on Monday.", passages: ["The archive opens on Monday."] };
const completedChoice = (content: unknown) => ({ finish_reason: "stop", message: { content } });
function safeFailure(error: unknown) {
  assert.ok(error instanceof IntegrationFailure); assert.equal(error.code, "invalid_response");
  assert.equal(error.cause, undefined); assert.doesNotMatch(error.message, /PRIVATE_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(error), /PRIVATE_SENTINEL/); return true;
}

test("faithfulness rejects malformed provider/model envelopes without retaining response details or retrying", async (t) => {
  let payload: unknown, calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json(payload); });
  const judge = new OpenRouterFaithfulnessJudge("https://synthetic.example", "synthetic-key", "synthetic-model");
  const valid = completedChoice(JSON.stringify(verdict));
  const invalid = [null, [], {}, { choices: null }, { choices: [] }, { choices: [valid, valid] },
    { choices: [valid], error: { message: "PRIVATE_SENTINEL" } },
    { choices: [{ ...valid, finish_reason: "length" }] }, { choices: [completedChoice(7)] },
    ...['{"PRIVATE_SENTINEL":', JSON.stringify({ claims: [] }), JSON.stringify({ claims: Array(17).fill(verdict.claims[0]) }),
      JSON.stringify({ claims: [{ claim: "PRIVATE_SENTINEL", evidence: "too short" }] }),
      JSON.stringify({ ...verdict, PRIVATE_SENTINEL: true })].map((content) => ({ choices: [completedChoice(content)] }))];
  for (payload of invalid) await assert.rejects(judge.assess(input, new AbortController().signal), safeFailure);
  assert.equal(calls, invalid.length);
});

test("faithfulness preserves native zero usage and valid receipts when verdict decoding fails", async (t) => {
  let content = JSON.stringify(verdict);
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [completedChoice(content)], usage: { prompt_tokens: 0, completion_tokens: 0, cost: 0 } }));
  const judge = new OpenRouterFaithfulnessJudge("https://synthetic.example", "synthetic-key", "synthetic-model"), observed: ProviderTokenUsage[] = [];
  assert.deepEqual(await judge.assess(input, new AbortController().signal, (value) => observed.push(value)), verdict.claims);
  content = '{"PRIVATE_SENTINEL":';
  await assert.rejects(judge.assess(input, new AbortController().signal, (value) => observed.push(value)), safeFailure);
  assert.deepEqual(observed, Array(2).fill({ inputTokens: 0, outputTokens: 0, costUsd: 0 }));
});

test("faithfulness leaves malformed usage unknown and retains an explicit unsupported claim", async (t) => {
  const unsupported = { claims: [{ claim: "The archive opens on Monday.", evidence: null }] };
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [completedChoice(JSON.stringify(unsupported))], usage: { prompt_tokens: "0", completion_tokens: 0 } }));
  const judge = new OpenRouterFaithfulnessJudge("https://synthetic.example", "synthetic-key", "synthetic-model"), observed: ProviderTokenUsage[] = [];
  assert.deepEqual(await judge.assess(input, new AbortController().signal, (value) => observed.push(value)), unsupported.claims);
  assert.deepEqual(observed, []);
});
