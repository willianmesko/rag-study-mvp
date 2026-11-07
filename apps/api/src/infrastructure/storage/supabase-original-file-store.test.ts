import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseOriginalFileStore } from "./supabase-original-file-store.js";

test("private originals recover lost upload acknowledgement only after byte verification", async (t) => {
  let calls = 0,
    matching = true;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      calls++;
      assert.equal(init.redirect, "error");
      assert.ok(init.signal);
      if (init.method === "POST")
        return Response.json(
          {
            message: "Asset already exists",
            error: "Duplicate",
            statusCode: "400",
          },
          { status: 400 },
        );
      return new Response(matching ? "same bytes" : "different bytes", {
        headers: { "content-type": "application/octet-stream" },
      });
    },
  );
  const store = new SupabaseOriginalFileStore(
    "https://fixture.supabase.co",
    "fixture-key",
    "private-originals",
  );
  const input = {
    path: "workspace/key/fingerprint-file.txt",
    payload: Buffer.from("same bytes"),
    contentType: "text/plain",
  };
  await store.put(input);
  assert.equal(calls, 2);
  matching = false;
  await assert.rejects(
    store.put(input),
    (error) =>
      error instanceof Error &&
      error.message === "Unable to store original file.",
  );
});
