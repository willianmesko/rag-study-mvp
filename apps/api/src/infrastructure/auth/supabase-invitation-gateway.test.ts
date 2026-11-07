import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SupabaseInvitationGateway } from "./supabase-invitation-gateway.js";
import { IntegrationFailure } from "../../application/integrations/retry-policy.js";
test("invitation transport is bounded and classifies rejections without returning upstream text", async (t) => {
  let status = 200,
    calls = 0;
  const id = randomUUID();
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      calls++;
      assert.equal(init.redirect, "error");
      assert.ok(init.signal);
      assert.equal(init.method, "POST");
      return Response.json(
        status === 200
          ? { id, email: "recipient@example.com" }
          : { msg: "PRIVATE_UPSTREAM_RECIPIENT", code: "fixture_failure" },
        { status },
      );
    },
  );
  const gateway = new SupabaseInvitationGateway(
    "https://fixture.supabase.co",
    "fixture-key",
    "https://app.example.com",
  );
  assert.equal(await gateway.send("recipient@example.com"), id);
  for (const [http, reason] of [
    [429, "rate_limited"],
    [403, "permanent_rejection"],
    [503, "transport_unknown"],
  ] as const) {
    status = http;
    await assert.rejects(
      gateway.send("recipient@example.com"),
      (error) =>
        error instanceof IntegrationFailure &&
        error.code === reason &&
        !error.message.includes("PRIVATE_"),
    );
  }
  assert.equal(calls, 4, "the SDK transport does not hide delivery retries");
});
