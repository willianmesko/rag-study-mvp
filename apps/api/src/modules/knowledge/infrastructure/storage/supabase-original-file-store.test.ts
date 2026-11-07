import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
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

test("cancelling a private-original read stops its HTTP body without cancelling another read", { timeout: 5_000 }, async (t) => {
  let started!: () => void;
  let disconnected!: () => void;
  const reading = new Promise<void>((resolve) => { started = resolve; });
  const closed = new Promise<void>((resolve) => { disconnected = resolve; });
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/octet-stream");
    if (request.url?.endsWith("/waiting.txt")) {
      response.write("partial private original");
      response.on("close", disconnected);
      started();
    } else response.end("completed original");
  });
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const store = new SupabaseOriginalFileStore(`http://127.0.0.1:${address.port}`, "fixture-key", "private-originals");
  const controller = new AbortController();
  t.after(() => controller.abort());
  const pending = store.get("workspace/waiting.txt", controller.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await reading;
  const independent = store.get("workspace/complete.txt");
  controller.abort();
  await rejected;
  await closed;
  assert.equal((await independent).toString(), "completed original");
});

test("a pre-cancelled original read performs no network request", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("Cancelled reads must not reach storage."));
  const controller = new AbortController();
  controller.abort();
  const store = new SupabaseOriginalFileStore("https://fixture.supabase.co", "fixture-key", "private-originals");
  await assert.rejects(store.get("workspace/cancelled.txt", controller.signal), { name: "AbortError" });
  assert.equal(fetch.mock.callCount(), 0);
});
