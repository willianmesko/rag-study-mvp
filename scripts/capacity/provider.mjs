import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { actorFromToken, fixtureModel, statement, vectorFor } from "./fixtures.mjs";

// This fixture has no provider SDK, credentials, external URLs or filesystem IO.
export function createFixtureServer() {
  const counters = { auth: 0, embedding: 0, chat: 0, aborted: 0, active: 0, peakActive: 0 };
  return createServer(async (request, response) => {
    const send = (status, body) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
    if (request.url === "/fixture/stats" && request.method === "GET") return send(200, counters);
    if (request.url === "/auth/v1/user" && request.method === "GET") {
      counters.auth++;
      const id = actorFromToken(request.headers.authorization);
      return id ? send(200, { id, aud: "authenticated", role: "authenticated" })
        : send(401, { error: "invalid_token" });
    }
    if (!["/api/embed", "/api/chat"].includes(request.url) || request.method !== "POST") return send(404, { error: "not_found" });
    const abort = new AbortController();
    response.once("close", () => { if (!response.writableEnded) { counters.aborted++; abort.abort(); } });
    counters.active++; counters.peakActive = Math.max(counters.peakActive, counters.active);
    try {
      let body = "", bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length; if (bytes > 128 * 1024) throw new Error("Fixture input limit.");
        body += chunk.toString();
      }
      const input = JSON.parse(body);
      if (input?.model !== fixtureModel) return send(400, { error: "unexpected_fixture_model" });
      await delay(25, undefined, { signal: abort.signal });
      if (request.url === "/api/embed") {
        if (typeof input.input !== "string") return send(400, { error: "invalid_fixture_input" });
        counters.embedding++;
        return send(200, { embeddings: [vectorFor(input.input)], prompt_eval_count: 32 });
      }
      counters.chat++;
      const content = JSON.stringify({ answer: statement, citedChunkIds: ["S1"], refusalReason: null });
      if (input.stream !== true) return send(200, { message: { content }, prompt_eval_count: 256, eval_count: 32 });
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      for (let offset = 0; offset < content.length; offset += 12) {
        response.write(JSON.stringify({ message: { content: content.slice(offset, offset + 12) }, done: false }) + "\n");
        await delay(10, undefined, { signal: abort.signal });
      }
      response.end(JSON.stringify({ message: { content: "" }, done: true, prompt_eval_count: 256, eval_count: 32 }) + "\n");
    } catch {
      if (!response.headersSent && !response.destroyed) send(400, { error: "fixture_request_failed" });
      else response.destroy();
    } finally { counters.active--; }
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const server = createFixtureServer();
  server.listen(11434, "0.0.0.0");
  process.once("SIGTERM", () => server.close(() => process.exit(0)));
}
