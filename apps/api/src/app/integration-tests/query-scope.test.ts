import assert from "node:assert/strict";
import test from "node:test";
import { get } from "node:http";
import { config } from "../../config.js";
import { currentProviderUsageScope } from "../../platform/observability/provider-usage-context.js";
import { buildApp } from "../http-server.js";

test("anonymous queries can only use the configured demo corpus in production", async () => {
  const original = { nodeEnv: process.env.NODE_ENV, demo: config.DEMO_MODE, apiKey: config.API_KEY };
  const searchedTenants: string[] = [];
  const searchSignals: AbortSignal[] = [];
  process.env.NODE_ENV = "production";
  config.DEMO_MODE = true;
  config.API_KEY = undefined;
  const app = await buildApp({
    searchDocuments: {
      async execute({ tenantId, signal }: { tenantId: string; signal: AbortSignal }) {
        searchedTenants.push(tenantId);
        searchSignals.push(signal);
        return [];
      }
    }
  } as unknown as Parameters<typeof buildApp>[0]);
  try {
    const demo = await app.inject({ method: "GET", url: "/v1/search?q=sample" });
    assert.equal(demo.statusCode, 200);
    assert.deepEqual(searchedTenants, [config.DEFAULT_TENANT_ID]);
    assert.ok(searchSignals[0] instanceof AbortSignal);
    assert.equal(searchSignals[0].aborted, false);

    const headers = { "x-workspace-id": "7b9521c0-415f-40c1-9f9d-8fe5527bb5e8" };
    assert.equal((await app.inject({ method: "GET", url: "/v1/search?q=sample", headers })).statusCode, 401);
    for (const url of ["/v1/qa", "/v1/qa/stream"]) {
      const response = await app.inject({ method: "POST", url, headers, payload: { question: "Sample?" } });
      assert.equal(response.statusCode, 401);
    }
    assert.equal((await app.inject({ method: "GET", url: "/v1/search?q=sample", headers: { authorization: "invalid" } })).statusCode, 401);

    config.DEMO_MODE = false;
    assert.equal((await app.inject({ method: "GET", url: "/v1/search?q=sample" })).statusCode, 401);
    assert.deepEqual(searchedTenants, [config.DEFAULT_TENANT_ID]);
  } finally {
    await app.close();
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original.nodeEnv;
    config.DEMO_MODE = original.demo;
    config.API_KEY = original.apiKey;
  }
});

test("disconnecting semantic search cancels its execution while retaining provider usage scope", async () => {
  const previous = { demo: config.DEMO_MODE, apiKey: config.API_KEY };
  config.DEMO_MODE = true;
  config.API_KEY = undefined;
  let started!: () => void, cancelled!: () => void;
  const executionStarted = new Promise<void>((resolve) => { started = resolve; });
  const executionCancelled = new Promise<void>((resolve) => { cancelled = resolve; });
  const app = await buildApp({
    searchDocuments: {
      async execute({ tenantId, signal }: { tenantId: string; signal: AbortSignal }) {
        assert.equal(tenantId, config.DEFAULT_TENANT_ID);
        assert.equal(currentProviderUsageScope()?.tenantId, tenantId);
        assert.ok(currentProviderUsageScope()?.actorKey.startsWith("anonymous:"));
        assert.ok(signal instanceof AbortSignal);
        started();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => { cancelled(); resolve(); }, { once: true }));
        return [];
      },
    },
  } as unknown as Parameters<typeof buildApp>[0]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: ReturnType<typeof get> | undefined;
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    request = get(`${address}/v1/search?q=sample`);
    request.on("error", () => {});
    const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Search cancellation did not reach execution.")), 2000); });
    await Promise.race([executionStarted, deadline]);
    request.destroy();
    await Promise.race([executionCancelled, deadline]);
  } finally {
    clearTimeout(timer);
    request?.destroy();
    await app.close();
    Object.assign(config, { DEMO_MODE: previous.demo, API_KEY: previous.apiKey });
  }
});
