import assert from "node:assert/strict";
import { Resolver } from "node:dns/promises";
import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders } from "node:http";
import https, { type RequestOptions } from "node:https";
import { Readable } from "node:stream";
import test, { type TestContext } from "node:test";
import type { DetailedPeerCertificate } from "node:tls";
import { PublicHtmlFetchError } from "../../application/ports/public-html-fetcher.js";
import { HttpsPublicHtmlFetcher } from "./public-html-fetcher.js";

const publicUrl = "https://docs.example.com/intro";
const publicAddress = "93.184.216.34";
const html = Buffer.from("<p>Informação</p>");
const htmlHeaders = { "content-type": "text/html; charset=UTF-8" };

function response(statusCode: number, headers: IncomingHttpHeaders, body = Readable.from([html])) {
  return Object.assign(body, { statusCode, headers });
}

function mockDns(t: TestContext, resolve = async (_hostname: string) => [publicAddress]) {
  return t.mock.method(Resolver.prototype, "resolve4", resolve);
}

function mockHttps(t: TestContext, buildResponse: (options: RequestOptions) => ReturnType<typeof response> | undefined) {
  return t.mock.method(https, "request", (options: RequestOptions, respond: (result: ReturnType<typeof response>) => void) => {
    const request = new EventEmitter();
    return Object.assign(request, {
      end() {
        const result = buildResponse(options);
        options.signal?.addEventListener("abort", () => {
          const error = new Error("fixture connection was aborted");
          if (result) result.destroy(error);
          else request.emit("error", error);
        }, { once: true });
        if (result) respond(result);
      }
    });
  });
}

const fetcher = (maxBytes = 1_024, timeoutMs = 1_000) => new HttpsPublicHtmlFetcher({ maxBytes, timeoutMs });

test("downloads public UTF-8 HTML by pinned IPv4 while verifying the URL hostname in TLS", async (t) => {
  const dns = mockDns(t);
  const request = mockHttps(t, (options) => {
    assert.equal(options.hostname, publicAddress);
    assert.equal(options.port, 443);
    assert.equal(options.agent, false);
    assert.equal(options.servername, "docs.example.com");
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.path, "/intro?lang=pt");
    assert.deepEqual(options.headers, { host: "docs.example.com", accept: "text/html", "accept-encoding": "identity" });
    const certificate = { subjectaltname: "DNS:docs.example.com" } as DetailedPeerCertificate;
    const wrongCertificate = { subjectaltname: "DNS:wrong.example.com" } as DetailedPeerCertificate;
    assert.equal(options.checkServerIdentity?.(publicAddress, certificate), undefined);
    assert.match(options.checkServerIdentity?.(publicAddress, wrongCertificate)?.message ?? "", /does not match certificate/);
    return response(200, { ...htmlHeaders, "content-encoding": "identity" });
  });

  assert.deepEqual(await fetcher().fetch(publicUrl + "?lang=pt#section"), {
    url: publicUrl + "?lang=pt",
    filename: "docs.example.com.html",
    payload: html
  });
  assert.equal(request.mock.callCount(), 1);
  assert.deepEqual(dns.mock.calls[0]?.arguments, ["docs.example.com."]);
});

test("rejects unsafe URL forms before DNS resolution", async (t) => {
  const dns = mockDns(t);
  const request = mockHttps(t, () => undefined);
  for (const url of [
    "http://docs.example.com/",
    "https://user:secret@docs.example.com/",
    "https://@docs.example.com/",
    "https:////@docs.example.com/",
    "https://docs.example.com:444/",
    "https://docs.example.com/" + "a".repeat(1_000)
  ]) {
    await assert.rejects(fetcher().fetch(url), { name: "PublicHtmlFetchError", code: "invalid_url" });
  }
  for (const url of [
    "https://127.1/",
    "https://2130706433/",
    "https://0x7f000001/",
    "https://[::ffff:127.0.0.1]/",
    "https://127.0.0.1./",
    "https://metadata.google.internal/",
    "https://server.localhost/"
  ]) {
    await assert.rejects(fetcher().fetch(url), { name: "PublicHtmlFetchError", code: "unsafe_destination" });
  }
  assert.equal(dns.mock.callCount(), 0);
  assert.equal(request.mock.callCount(), 0);
});

test("rejects private and reserved addresses, even when DNS also returns a public address", async (t) => {
  const dns = mockDns(t);
  const request = mockHttps(t, () => undefined);
  for (const address of [
    "0.0.0.1", "10.1.2.3", "100.100.100.200", "127.0.0.1", "168.63.129.16", "169.254.169.254",
    "172.16.10.3", "192.0.0.12", "192.0.2.1", "192.168.50.1", "198.19.0.1", "198.51.100.2",
    "203.0.113.3", "224.0.0.1", "240.10.0.1", "255.255.255.255", "::ffff:127.0.0.1"
  ]) {
    dns.mock.mockImplementationOnce(async () => [publicAddress, address]);
    await assert.rejects(fetcher().fetch(publicUrl), { name: "PublicHtmlFetchError", code: "unsafe_destination" });
  }
  assert.equal(request.mock.callCount(), 0);
});

test("handles relative and cross-host redirects with a new DNS check for each connection", async (t) => {
  const dns = mockDns(t, async (hostname) => [hostname === "guides.example.com." ? "1.1.1.1" : publicAddress]);
  const first = response(302, { location: "/welcome#skip" });
  const second = response(308, { location: "https://guides.example.com/handbook#intro" });
  const responses = [first, second, response(200, htmlHeaders)];
  const request = mockHttps(t, () => responses.shift());
  const result = await fetcher().fetch(publicUrl);
  assert.equal(result.url, "https://guides.example.com/handbook");
  assert.equal(result.filename, "guides.example.com.html");
  assert.equal(first.destroyed, true);
  assert.equal(second.destroyed, true);
  assert.deepEqual(dns.mock.calls.map((call) => call.arguments[0]), ["docs.example.com.", "docs.example.com.", "guides.example.com."]);
  const options = request.mock.calls.map((call) => call.arguments[0] as RequestOptions);
  assert.deepEqual(options.map(({ hostname, servername, path }) => [hostname, servername, path]), [
    [publicAddress, "docs.example.com", "/intro"],
    [publicAddress, "docs.example.com", "/welcome"],
    ["1.1.1.1", "guides.example.com", "/handbook"]
  ]);
  assert.ok(options.every(({ signal }) => signal === options[0]?.signal));
});

test("blocks a same-host redirect when its new DNS answer is private", async (t) => {
  const dns = mockDns(t);
  dns.mock.mockImplementationOnce(async () => ["127.0.0.1"], 1);
  const request = mockHttps(t, () => response(302, { location: "/another" }));
  await assert.rejects(fetcher().fetch(publicUrl), { name: "PublicHtmlFetchError", code: "unsafe_destination" });
  assert.equal(dns.mock.callCount(), 2);
  assert.equal(request.mock.callCount(), 1);
});

test("refuses redirects to HTTP, private literals, and oversized absolute URLs", async (t) => {
  const dns = mockDns(t);
  const redirected = [
    { location: "http://docs.example.com/", code: "invalid_url" },
    { location: "https://169.254.169.254/", code: "unsafe_destination" },
    { location: "/" + "a".repeat(985), code: "invalid_url" }
  ];
  let location = "";
  const request = mockHttps(t, () => response(302, { location }));
  for (const item of redirected) {
    location = item.location;
    await assert.rejects(fetcher().fetch(publicUrl), { name: "PublicHtmlFetchError", code: item.code });
  }
  assert.equal(dns.mock.callCount(), redirected.length);
  assert.equal(request.mock.callCount(), redirected.length);
});

test("caps the number of redirect hops", async (t) => {
  const dns = mockDns(t);
  const request = mockHttps(t, () => response(302, { location: "/repeat" }));
  await assert.rejects(fetcher().fetch(publicUrl), { name: "PublicHtmlFetchError", code: "redirect_limit" });
  assert.equal(dns.mock.callCount(), 4);
  assert.equal(request.mock.callCount(), 4);
});

test("refuses unsupported status, content type, compression, or non-UTF-8 HTML", async (t) => {
  mockDns(t);
  const cases = [
    { result: response(404, htmlHeaders), code: "fetch_failed" },
    { result: response(206, htmlHeaders), code: "fetch_failed" },
    { result: response(200, { "content-type": "application/xhtml+xml" }), code: "unsupported_content_type" },
    { result: response(200, { ...htmlHeaders, "content-encoding": "gzip" }), code: "invalid_encoding" },
    { result: response(200, { ...htmlHeaders, "transfer-encoding": "gzip, chunked" }), code: "invalid_encoding" },
    { result: response(200, { "content-type": "text/html; charset=windows-1252" }), code: "invalid_encoding" },
    { result: response(200, htmlHeaders, Readable.from([Buffer.from([0xff])])), code: "invalid_encoding" }
  ];
  const results = cases.map(({ result }) => result);
  mockHttps(t, () => results.shift());
  for (const { result, code } of cases) {
    await assert.rejects(fetcher().fetch(publicUrl), { name: "PublicHtmlFetchError", code });
    assert.equal(result.destroyed, true);
  }
});

test("enforces the byte limit against both Content-Length and the streamed body", async (t) => {
  mockDns(t);
  const declared = response(200, { ...htmlHeaders, "content-length": "20" });
  const streamed = response(200, { ...htmlHeaders, "transfer-encoding": "chunked" }, Readable.from([Buffer.alloc(6), Buffer.alloc(5)]));
  const responses = [declared, streamed];
  mockHttps(t, () => responses.shift());
  for (const result of [declared, streamed]) {
    await assert.rejects(fetcher(10).fetch(publicUrl), { name: "PublicHtmlFetchError", code: "response_too_large" });
    assert.equal(result.destroyed, true);
  }
});

test("streams HTML across buffer growth without changing its bytes", async (t) => {
  mockDns(t);
  const first = Buffer.alloc(16_380, "a");
  const second = Buffer.from("Some multi-byte characters: informação.");
  mockHttps(t, () => response(200, htmlHeaders, Readable.from([first, second])));
  assert.deepEqual((await fetcher(first.length + second.length).fetch(publicUrl)).payload, Buffer.concat([first, second]));
});

test("maps resolver failures without exposing DNS details", async (t) => {
  mockDns(t, async () => { throw new Error("sensitive native details"); });
  const request = mockHttps(t, () => undefined);
  await assert.rejects(fetcher().fetch(publicUrl), new PublicHtmlFetchError("dns_failed"));
  assert.equal(request.mock.callCount(), 0);
});

test("cancels a DNS lookup when the total deadline expires", async (t) => {
  let rejectLookup: (error: Error) => void = () => {};
  mockDns(t, () => new Promise<string[]>((_, reject) => { rejectLookup = reject; }));
  const cancel = t.mock.method(Resolver.prototype, "cancel", () => rejectLookup(new Error("cancelled")));
  const request = mockHttps(t, () => undefined);
  await assert.rejects(fetcher(1_024, 25).fetch(publicUrl), { name: "PublicHtmlFetchError", code: "fetch_timeout" });
  assert.equal(cancel.mock.callCount(), 1);
  assert.equal(request.mock.callCount(), 0);
});

test("aborts both a stalled HTTPS handshake and a stalled response body", async (t) => {
  mockDns(t);
  const stalledBody = response(200, htmlHeaders, new Readable({ read() {} }));
  const responses = [undefined, stalledBody];
  const request = mockHttps(t, () => responses.shift());
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(fetcher(1_024, 25).fetch(publicUrl), { name: "PublicHtmlFetchError", code: "fetch_timeout" });
  }
  assert.equal(stalledBody.destroyed, true);
  assert.ok(request.mock.calls.every((call) => (call.arguments[0] as RequestOptions).signal?.aborted));
});
