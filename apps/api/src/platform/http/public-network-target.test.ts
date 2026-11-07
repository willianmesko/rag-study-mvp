import assert from "node:assert/strict";
import { Resolver } from "node:dns/promises";
import { EventEmitter } from "node:events";
import https, { type RequestOptions } from "node:https";
import test from "node:test";
import type { DetailedPeerCertificate } from "node:tls";
import { parseTarget, resolvePublicAddress, PublicNetworkTargetError } from "./public-network-target.js";
import { postPublicWebhook } from "./public-webhook-client.js";

test("shared target policy preserves canonical HTTPS and content-free neutral failures", () => {
  assert.equal(parseTarget("https://HOOKS.example.com./delivery#fragment").href, "https://hooks.example.com/delivery");
  assert.equal(parseTarget("../next", new URL("https://hooks.example.com/path/current")).href, "https://hooks.example.com/next");
  for (const [url, code] of [
    ["http://hooks.example.com/", "invalid_url"],
    ["https://user:PRIVATE_PASSWORD@hooks.example.com/", "invalid_url"],
    ["https://@hooks.example.com/", "invalid_url"],
    ["https://hooks.example.com:444/", "invalid_url"],
    ["https://127.1/", "unsafe_destination"],
    ["https://metadata.google.internal/", "unsafe_destination"],
    ["https://[::ffff:127.0.0.1]/", "unsafe_destination"],
  ] as const) assert.throws(() => parseTarget(url), (error) => {
    assert.ok(error instanceof PublicNetworkTargetError);
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /PRIVATE_PASSWORD|metadata.google/);
    return true;
  });
});

test("shared DNS policy rejects mixed public/private answers before webhook transport", async (t) => {
  t.mock.method(Resolver.prototype, "resolve4", async () => ["93.184.216.34", "169.254.169.254"]);
  const request = t.mock.method(https, "request", () => assert.fail("Unsafe DNS must not create a socket."));
  await assert.rejects(postPublicWebhook("https://hooks.example.com/delivery", { method: "POST", body: "{}" }), (error) =>
    error instanceof PublicNetworkTargetError && error.code === "unsafe_destination");
  assert.equal(request.mock.callCount(), 0);
});

test("webhook uses shared vetted DNS while retaining hostname TLS, Host and response limits", async (t) => {
  const dns = t.mock.method(Resolver.prototype, "resolve4", async () => ["93.184.216.34"]);
  const body = JSON.stringify({ id: "fixture", message: "bounded" });
  let sentBody: unknown, destroyed = false;
  const request = t.mock.method(https, "request", (options: RequestOptions, respond: (response: { statusCode: number; headers: Record<string, string>; destroy(): void }) => void) => {
    assert.equal(options.hostname, "93.184.216.34");
    assert.equal(options.servername, "hooks.example.com");
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.agent, false);
    assert.equal(options.port, 443);
    assert.equal(options.path, "/delivery?version=1");
    assert.equal((options.headers as Record<string, string>).host, "hooks.example.com");
    assert.equal((options.headers as Record<string, string>)["content-length"], String(Buffer.byteLength(body)));
    assert.equal(options.checkServerIdentity?.("93.184.216.34", { subjectaltname: "DNS:hooks.example.com" } as DetailedPeerCertificate), undefined);
    assert.ok(options.checkServerIdentity?.("93.184.216.34", { subjectaltname: "DNS:other.example.com" } as DetailedPeerCertificate));
    return Object.assign(new EventEmitter(), { end(value: unknown) {
      sentBody = value;
      respond({ statusCode: 204, headers: { "retry-after": "10", "set-cookie": "PRIVATE_COOKIE" }, destroy() { destroyed = true; } });
    } });
  });
  const response = await postPublicWebhook("https://hooks.example.com/delivery?version=1", { method: "POST", body });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("retry-after"), "10");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(sentBody, body);
  assert.equal(destroyed, true);
  assert.equal(request.mock.callCount(), 1);
  assert.deepEqual(dns.mock.calls[0].arguments, ["hooks.example.com."]);
});

test("webhook does not follow a redirect into another destination", async (t) => {
  const dns = t.mock.method(Resolver.prototype, "resolve4", async () => ["93.184.216.34"]);
  const request = t.mock.method(https, "request", (_options: RequestOptions, respond: (response: { statusCode: number; headers: Record<string, string>; destroy(): void }) => void) =>
    Object.assign(new EventEmitter(), { end() { respond({ statusCode: 302, headers: { location: "https://127.0.0.1/private" }, destroy() {} }); } }));
  const response = await postPublicWebhook("https://hooks.example.com/", { method: "POST", body: "{}" });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), null);
  assert.equal(request.mock.callCount(), 1);
  assert.equal(dns.mock.callCount(), 1);
});

test("shared DNS cancellation and resolver failures expose only neutral reason codes", async (t) => {
  let rejectLookup!: (reason: Error) => void;
  t.mock.method(Resolver.prototype, "resolve4", () => new Promise<string[]>((_resolve, reject) => { rejectLookup = reject; }));
  const cancel = t.mock.method(Resolver.prototype, "cancel", () => rejectLookup(new Error("PRIVATE_DNS_DETAIL")));
  const controller = new AbortController();
  const pending = resolvePublicAddress("hooks.example.com", controller.signal);
  controller.abort();
  await assert.rejects(pending, (error) => error instanceof PublicNetworkTargetError && error.code === "dns_failed" && !error.message.includes("PRIVATE_DNS_DETAIL"));
  assert.equal(cancel.mock.callCount(), 1);
});
