import { Resolver } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIPv4 } from "node:net";
import { checkServerIdentity } from "node:tls";
import { PublicHtmlFetchError, type PublicHtmlFetcher } from "../../application/ports/public-html-fetcher.js";

const maxUrlLength = 1_000;
const maxRedirects = 3;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

// Block IANA special-purpose, multicast, and reserved ranges. Azure's platform
// virtual address is also blocked even though it uses a publicly assigned IP.
const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["168.63.129.16", 32], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.31.196.0", 24],
  ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}

export class HttpsPublicHtmlFetcher implements PublicHtmlFetcher {
  constructor(private readonly options: { maxBytes: number; timeoutMs: number }) {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
      throw new Error("The HTML download byte limit must be a positive integer.");
    }
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 2_147_483_647) {
      throw new Error("The HTML download timeout must be a positive timer duration in milliseconds.");
    }
  }

  async fetch(url: string): Promise<{ url: string; filename: string; payload: Buffer }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const { signal } = controller;

    try {
      let target = parseTarget(url);
      for (let redirects = 0; ; redirects++) {
        const address = await resolvePublicAddress(target.hostname, signal);
        const response = await requestPinned(target, address, signal);
        try {
          if (redirectStatuses.has(response.statusCode ?? 0)) {
            if (redirects === maxRedirects) throw new PublicHtmlFetchError("redirect_limit");
            if (!response.headers.location) throw new PublicHtmlFetchError("fetch_failed");
            target = parseTarget(response.headers.location, target);
            continue;
          }

          if (response.statusCode !== 200) throw new PublicHtmlFetchError("fetch_failed");
          const payload = await readHtml(response, this.options.maxBytes);
          signal.throwIfAborted();
          return { url: target.href, filename: target.hostname.slice(0, 180) + ".html", payload };
        } finally {
          response.destroy();
        }
      }
    } catch (error) {
      if (signal.aborted) throw new PublicHtmlFetchError("fetch_timeout");
      if (error instanceof PublicHtmlFetchError) throw error;
      throw new PublicHtmlFetchError("fetch_failed");
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseTarget(value: string, base?: URL): URL {
  // Reject parser corrections that could obscure the authority, including an
  // explicit but empty credentials segment that URL.username would discard.
  const absolute = /^https:\/\//i.test(value);
  const authority = /^(?:https:)?\/\/([^/?#]+)/i.exec(value)?.[1];
  const hasAuthority = absolute || value.startsWith("//");
  if (value.length > maxUrlLength || /[\u0000-\u0020\u007f\\]/.test(value)
    || (hasAuthority && (!authority || authority.includes("@")))
    || (!absolute && (!base || /^[a-z][a-z\d+.-]*:/i.test(value)))) {
    throw new PublicHtmlFetchError("invalid_url");
  }

  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new PublicHtmlFetchError("invalid_url");
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) {
    throw new PublicHtmlFetchError("invalid_url");
  }

  const hostname = url.hostname.replace(/\.$/, "");
  if (isIPv4(hostname) || hostname.startsWith("[") || /(?:^|\.)(?:localhost|local|internal|home\.arpa|onion)$/.test(hostname)) {
    throw new PublicHtmlFetchError("unsafe_destination");
  }
  if (!hostname.includes(".") || hostname.length > 253
    || !hostname.split(".").every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label))) {
    throw new PublicHtmlFetchError("invalid_url");
  }

  url.hostname = hostname;
  url.hash = "";
  if (url.href.length > maxUrlLength) throw new PublicHtmlFetchError("invalid_url");
  return url;
}

async function resolvePublicAddress(hostname: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  // A records only. The socket connects directly to the vetted IPv4 address.
  const resolver = new Resolver({ tries: 1 });
  const cancel = () => resolver.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  let addresses: string[];
  try {
    addresses = await resolver.resolve4(hostname + ".");
  } catch {
    throw new PublicHtmlFetchError("dns_failed");
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  if (!addresses.length) throw new PublicHtmlFetchError("dns_failed");
  if (addresses.some((address) => !isIPv4(address) || blockedIpv4.check(address, "ipv4"))) {
    throw new PublicHtmlFetchError("unsafe_destination");
  }
  return addresses[0]!;
}

function requestPinned(target: URL, address: string, signal: AbortSignal): Promise<IncomingMessage> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: address,
      port: 443,
      path: target.pathname + target.search,
      method: "GET",
      // An isolated agent avoids connection reuse and global proxy settings.
      agent: false,
      servername: target.hostname,
      rejectUnauthorized: true,
      checkServerIdentity: (_hostname, certificate) => checkServerIdentity(target.hostname, certificate),
      maxHeaderSize: 16_384,
      signal,
      headers: {
        host: target.hostname,
        accept: "text/html",
        "accept-encoding": "identity"
      }
    }, resolve);
    request.once("error", reject);
    request.once("close", () => reject(new PublicHtmlFetchError("fetch_failed")));
    request.end();
  });
}

async function readHtml(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const [contentType, ...parameters] = (response.headers["content-type"] ?? "").split(";");
  if (contentType.trim().toLowerCase() !== "text/html") throw new PublicHtmlFetchError("unsupported_content_type");

  const encoding = response.headers["content-encoding"];
  const transferEncoding = response.headers["transfer-encoding"];
  const charsets = parameters.map((parameter) => parameter.trim()).filter((parameter) => /^charset(?:\s|=|$)/i.test(parameter));
  if ((encoding !== undefined && encoding.trim().toLowerCase() !== "identity")
    || (transferEncoding !== undefined && transferEncoding.trim().toLowerCase() !== "chunked")
    || charsets.length > 1 || charsets.some((charset) => !/^charset\s*=\s*(?:"utf-8"|utf-8)$/i.test(charset))) {
    throw new PublicHtmlFetchError("invalid_encoding");
  }
  if (Number(response.headers["content-length"]) > maxBytes) throw new PublicHtmlFetchError("response_too_large");

  // Copy incoming bytes into bounded storage. Tiny HTTP chunks must not retain
  // an unbounded number of backing buffers until the download completes.
  let buffer = Buffer.allocUnsafe(Math.min(16_384, maxBytes));
  let size = 0;
  for await (const chunk of response) {
    const bytes: Buffer = chunk;
    const nextSize = size + bytes.length;
    if (nextSize > maxBytes) throw new PublicHtmlFetchError("response_too_large");
    if (nextSize > buffer.length) {
      const expanded = Buffer.allocUnsafe(Math.min(maxBytes, Math.max(nextSize, buffer.length * 2)));
      buffer.copy(expanded, 0, 0, size);
      buffer = expanded;
    }
    bytes.copy(buffer, size);
    size = nextSize;
  }

  const payload = buffer.subarray(0, size);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    throw new PublicHtmlFetchError("invalid_encoding");
  }
  return payload;
}
