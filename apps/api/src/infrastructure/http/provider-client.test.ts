import assert from "node:assert/strict";
import test from "node:test";
import {
  maxProviderResponseBytes,
  requestProviderJson,
} from "./provider-client.js";
test("an oversized provider response is cancelled before JSON decoding", async (t) => {
  let cancelled = false;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(maxProviderResponseBytes + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200 },
      ),
  );
  await assert.rejects(
    requestProviderJson("https://fixture.example.test", {}),
    /size limit/,
  );
  assert.equal(cancelled, true);
});
