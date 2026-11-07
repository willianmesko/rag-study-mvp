import assert from "node:assert/strict";
import test from "node:test";
import { retryAfterMs, retryDelayMs, classifyStatus } from "./retry-policy.js";

test("bounded jitter, Retry-After dates and permanent delivery classification are consistent", () => {
  assert.equal(retryDelayMs(1, { random: () => 0 }), 250);
  assert.equal(retryDelayMs(30, { random: () => 1 }), 60_000);
  assert.equal(
    retryDelayMs(1, { random: () => 0, retryAfterMs: 20_000 }),
    20_000,
  );
  assert.equal(retryAfterMs("2"), 2000);
  assert.equal(
    retryAfterMs(
      "Sat, 07 Nov 2026 12:00:10 GMT",
      Date.parse("2026-11-07T12:00:00Z"),
    ),
    10000,
  );
  assert.equal(retryAfterMs("invalid"), undefined);
  for (const status of [200, 204, 299])
    assert.equal(classifyStatus(status), "delivered");
  for (const status of [408, 429, 500, 503])
    assert.equal(classifyStatus(status), "retry");
  for (const status of [301, 400, 401, 403, 404, 422])
    assert.equal(classifyStatus(status), "dead_letter");
});
