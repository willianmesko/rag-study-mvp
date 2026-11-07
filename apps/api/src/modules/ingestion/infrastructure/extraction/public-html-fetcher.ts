import type { IncomingMessage } from "node:http";
import https from "node:https";
import { checkServerIdentity } from "node:tls";
import { PublicHtmlFetchError, type PublicHtmlFetcher } from "../../application/ports/public-html-fetcher.js";
import { parseTarget, resolvePublicAddress, PublicNetworkTargetError } from "../../../../platform/http/public-network-target.js";

const maxRedirects = 3;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

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
      if (error instanceof PublicNetworkTargetError) throw new PublicHtmlFetchError(error.code);
      if (error instanceof PublicHtmlFetchError) throw error;
      throw new PublicHtmlFetchError("fetch_failed");
    } finally {
      clearTimeout(timer);
    }
  }
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
