import { setTimeout as delay } from "node:timers/promises";
import { defaultProviderTimeoutMs } from "./provider-timeout.js";
import {
  IntegrationFailure,
  retryAfterMs,
  retryDelayMs,
} from "../integrations/retry-policy.js";
import { currentExecution } from "../workflows/execution-context.js";
import { reserveTransient } from "../workflows/transient-budget.js";
import { recordOperationalEvent } from "../observability/observer.js";

export const maxProviderResponseBytes = 2 * 1024 * 1024;
export function providerRequestSignal(
  signal?: AbortSignal | null,
  timeoutMs = defaultProviderTimeoutMs,
): AbortSignal {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    throw new Error("Provider deadlines require bounded millisecond values.");
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

export type ProviderRequestOptions = {
  timeoutMs?: number;
  maxAttempts?: number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};
export type ProviderHttpClient = {
  requestJson: (url: string, init: RequestInit) => Promise<unknown>;
  requestResponse: (url: string, init: RequestInit) => Promise<Response>;
  signal: (parent?: AbortSignal | null) => AbortSignal;
};
export function createProviderHttpClient(timeoutMs: number): ProviderHttpClient {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    throw new Error("Provider deadlines require bounded millisecond values.");
  return Object.freeze({
    requestJson: (url: string, init: RequestInit) => requestProviderJson(url, init, { timeoutMs }),
    requestResponse: (url: string, init: RequestInit) => requestProviderResponse(url, init, { timeoutMs }),
    signal: (parent?: AbortSignal | null) => providerRequestSignal(parent, timeoutMs),
  });
}
export const defaultProviderHttpClient = createProviderHttpClient(defaultProviderTimeoutMs);

/** Retry only a rejected 429, before receiving any output. An ambiguous paid POST is never blindly retried. */
export async function requestProviderResponse(
  url: string,
  init: RequestInit,
  options: ProviderRequestOptions = {},
): Promise<Response> {
  const signal = providerRequestSignal(init.signal, options.timeoutMs),
    maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3)
    throw new Error("Provider attempts must be between one and three.");
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(url, { ...init, redirect: "error", signal });
    } catch {
      signal.throwIfAborted();
      throw new IntegrationFailure("transport_unknown");
    }
    if (response.ok) return response;
    const retryAfter = retryAfterMs(response.headers.get("retry-after"));
    await response.body?.cancel().catch(() => {});
    if (response.status === 429 && attempt < maxAttempts) {
      const waitMs = retryDelayMs(attempt, { retryAfterMs: retryAfter });
      // A long rate-limit window belongs in durable work, not an in-flight request.
      if (waitMs > 10_000)
        throw new IntegrationFailure("rate_limited", 429, waitMs);
      const execution = currentExecution();
      if (execution)
        await execution.repository.reserve(execution.lease, { calls: 1 });
      else reserveTransient({ calls: 1 });
      recordOperationalEvent({
        operation: "provider_request",
        outcome: "retry",
        reason: "rate_limited",
      });
      await (
        options.wait ??
        ((ms, active) => delay(ms, undefined, { signal: active }))
      )(waitMs, signal);
      continue;
    }
    throw new IntegrationFailure(
      response.status === 429
        ? "rate_limited"
        : response.status === 408 || response.status >= 500
          ? "remote_unavailable"
          : "permanent_rejection",
      response.status,
      retryAfter,
    );
  }
  throw new IntegrationFailure("rate_limited", 429);
}
export async function requestProviderJson(
  url: string,
  init: RequestInit,
  options: ProviderRequestOptions = {},
): Promise<unknown> {
  const response = await requestProviderResponse(url, init, options);
  const text = await boundedResponseText(response, maxProviderResponseBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new IntegrationFailure("invalid_response");
  }
}
async function boundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) throw new IntegrationFailure("invalid_response");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes)
        throw new Error("The provider response exceeded its size limit.");
      chunks.push(value);
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
