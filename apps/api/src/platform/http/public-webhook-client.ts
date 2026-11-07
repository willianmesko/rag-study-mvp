import https from "node:https";
import { checkServerIdentity } from "node:tls";
import {
  parseTarget,
  resolvePublicAddress,
} from "./public-network-target.js";

/** The socket uses a vetted address; TLS and Host still validate the configured hostname. No redirects/proxies. */
export async function postPublicWebhook(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const target = parseTarget(url),
    signal = init.signal ?? AbortSignal.timeout(3000);
  const address = await resolvePublicAddress(target.hostname, signal);
  const body = typeof init.body === "string" ? init.body : "";
  if (!body || Buffer.byteLength(body) > 8192 || init.method !== "POST")
    throw new Error("Webhook request exceeds its fixed policy.");
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const request = https.request(
      {
        hostname: address,
        servername: target.hostname,
        port: 443,
        method: "POST",
        path: target.pathname + target.search,
        agent: false,
        rejectUnauthorized: true,
        checkServerIdentity: (_hostname, certificate) =>
          checkServerIdentity(target.hostname, certificate),
        signal,
        maxHeaderSize: 16_384,
        headers: {
          ...headers,
          host: target.hostname,
          "content-length": String(Buffer.byteLength(body)),
        },
      },
      (response) => {
        const status = response.statusCode ?? 502;
        const retryAfter = response.headers["retry-after"];
        response.destroy();
        resolve(
          new Response(null, {
            status,
            headers: retryAfter ? { "retry-after": String(retryAfter) } : {},
          }),
        );
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}
