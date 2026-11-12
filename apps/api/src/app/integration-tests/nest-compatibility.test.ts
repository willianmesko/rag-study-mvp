import assert from "node:assert/strict";
import test from "node:test";
import { parseRuntimeConfiguration } from "../configuration/environment.js";
import type { HttpDependencies } from "../http-dependencies.js";
import { buildApp } from "../http-server.js";
import { createNestHttpServer } from "../nest/bootstrap.js";

test("Nest owns the health endpoint while legacy routes retain their paths and safe errors", async (t) => {
  const runtime = await createNestHttpServer(parseRuntimeConfiguration({}), { dependencies: {} as HttpDependencies, isProduction: true });
  t.after(() => runtime.nest.close());
  const health = await runtime.fastify.inject("/health");
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: "ok", capabilities: { pdfOcr: false, durableWorkflows: false, durableConversations: false } });
  assert.equal(health.headers["cache-control"], "no-store");
  assert.match(String(health.headers["x-request-id"]), /^[0-9a-f-]{36}$/);
  assert.equal((await runtime.fastify.inject("/v1/search?q=fixture")).statusCode, 401);
  assert.equal((await runtime.fastify.inject({ method: "POST", url: "/v1/qa", payload: "{", headers: { "content-type": "application/json" } })).statusCode, 400);
});


test("Nest retains the existing Fastify 404 response contract", async (t) => {
  const configuration = parseRuntimeConfiguration({});
  const dependencies = {} as HttpDependencies;
  const runtime = await createNestHttpServer(configuration, { dependencies });
  const previous = await buildApp(dependencies, { configuration });
  t.after(async () => { await previous.close(); await runtime.nest.close(); });
  const expected = await previous.inject("/unknown-path");
  const actual = await runtime.fastify.inject("/unknown-path");
  assert.equal(actual.statusCode, expected.statusCode);
  assert.deepEqual(actual.json(), expected.json());
});
