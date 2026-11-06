import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../../config.js";
import { buildApp } from "./app.js";

test("anonymous queries can only use the configured demo corpus in production", async () => {
  const original = { nodeEnv: process.env.NODE_ENV, demo: config.DEMO_MODE, apiKey: config.API_KEY };
  const searchedTenants: string[] = [];
  process.env.NODE_ENV = "production";
  config.DEMO_MODE = true;
  config.API_KEY = undefined;
  const app = await buildApp({
    searchDocuments: {
      async execute({ tenantId }: { tenantId: string }) {
        searchedTenants.push(tenantId);
        return [];
      }
    }
  } as unknown as Parameters<typeof buildApp>[0]);
  try {
    const demo = await app.inject({ method: "GET", url: "/v1/search?q=sample" });
    assert.equal(demo.statusCode, 200);
    assert.deepEqual(searchedTenants, [config.DEFAULT_TENANT_ID]);

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
