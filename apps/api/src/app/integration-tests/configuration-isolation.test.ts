import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { currentProviderUsageScope } from "../../platform/observability/provider-usage-context.js";
import { parseRuntimeConfiguration } from "../configuration/environment.js";
import { buildApp } from "../http-server.js";

const dependencies = (input: object) => input as Parameters<typeof buildApp>[0];

test("two HTTP instances keep separate explicit keys, origins and capabilities", async (t) => {
  const a = parseRuntimeConfiguration({ API_KEY: "synthetic-instance-a-key", ALLOWED_ORIGINS: "https://a.example", PDF_OCR_ENABLED: "true" });
  const b = parseRuntimeConfiguration({ API_KEY: "synthetic-instance-b-key", ALLOWED_ORIGINS: "https://b.example" });
  const first = await buildApp(dependencies({}), { configuration: a, isProduction: true });
  const second = await buildApp(dependencies({}), { configuration: b, isProduction: true });
  t.after(async () => { await Promise.all([first.close(), second.close()]); });
  const read = (app: typeof first, key: string, origin: string) => app.inject({ url: "/health", headers: { "x-api-key": key, origin } });
  const [allowedA, allowedB, wrongA, wrongB] = await Promise.all([
    read(first, a.API_KEY!, "https://a.example"), read(second, b.API_KEY!, "https://b.example"),
    read(first, b.API_KEY!, "https://a.example"), read(second, a.API_KEY!, "https://b.example"),
  ]);
  assert.equal(allowedA.statusCode, 200); assert.equal(allowedB.statusCode, 200);
  assert.equal(allowedA.json().capabilities.pdfOcr, true); assert.equal(allowedB.json().capabilities.pdfOcr, false);
  assert.equal(allowedA.headers["access-control-allow-origin"], "https://a.example");
  assert.equal(allowedB.headers["access-control-allow-origin"], "https://b.example");
  assert.equal(wrongA.statusCode, 401); assert.equal(wrongB.statusCode, 401);
  assert.equal((await read(first, a.API_KEY!, "https://b.example")).statusCode, 403);
  assert.equal((await read(second, b.API_KEY!, "https://a.example")).statusCode, 403);
});

test("explicit production policy and anonymous hashing do not borrow another instance's settings", async (t) => {
  const settings = parseRuntimeConfiguration({ DEMO_MODE: "true", ADMIN_API_KEY: "synthetic-admin-key", USAGE_HASH_SECRET: "a".repeat(32), DEFAULT_TENANT_ID: "11111111-1111-4111-a111-111111111111" });
  const secure = parseRuntimeConfiguration({ USAGE_HASH_SECRET: "b".repeat(32) });
  const calls: Array<{ tenantId: string; actorKey: string }> = [];
  const searchDocuments = { async execute(input: { tenantId: string }) {
    const scope = currentProviderUsageScope(); assert.ok(scope);
    calls.push({ tenantId: input.tenantId, actorKey: scope.actorKey }); return [];
  } };
  const demo = await buildApp(dependencies({ searchDocuments }), { configuration: settings, isProduction: true });
  const privateApp = await buildApp(dependencies({ searchDocuments }), { configuration: secure, isProduction: true });
  t.after(async () => { await Promise.all([demo.close(), privateApp.close()]); });
  const [allowed, denied] = await Promise.all([demo.inject("/v1/search?q=sample"), privateApp.inject("/v1/search?q=sample")]);
  assert.equal(allowed.statusCode, 200); assert.equal(denied.statusCode, 401);
  assert.equal(calls.length, 1); assert.equal(calls[0]?.tenantId, settings.DEFAULT_TENANT_ID);
  const expected = `anonymous:${createHmac("sha256", settings.USAGE_HASH_SECRET!).update("127.0.0.1").digest("hex").slice(0, 32)}`;
  assert.equal(calls[0]?.actorKey, expected);
  assert.equal((await privateApp.inject("/v1/search?q=sample")).statusCode, 401);
  assert.equal((await demo.inject("/v1/search?q=sample")).statusCode, 200);
  assert.equal(calls.length, 2);
});

test("explicit HTTP settings do not parse an unrelated invalid process environment on import", async () => {
  const { execFileSync } = await import("node:child_process");
  const parser = new URL("../configuration/environment.ts", import.meta.url).href;
  const http = new URL("../http-server.ts", import.meta.url).href;
  const code = `
    const { parseRuntimeConfiguration } = await import(${JSON.stringify(parser)});
    const { buildApp } = await import(${JSON.stringify(http)});
    const app = await buildApp({}, { configuration: parseRuntimeConfiguration({}), isProduction: true });
    try { if ((await app.inject('/health')).statusCode !== 200) throw new Error('Synthetic health failed.'); }
    finally { await app.close(); }
  `;
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], {
    env: { PATH: process.env.PATH, CHUNK_OVERLAP: "99999" }, timeout: 10_000, stdio: "pipe",
  });
});
