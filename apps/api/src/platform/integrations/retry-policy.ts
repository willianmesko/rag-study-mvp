/** Safe, provider-independent reasons. Never retain upstream bodies or credentials. */
export type IntegrationReason =
  | "rate_limited"
  | "remote_unavailable"
  | "permanent_rejection"
  | "transport_unknown"
  | "invalid_response"
  | "cancelled"
  | "deadline_exceeded";
export class IntegrationFailure extends Error {
  constructor(
    readonly code: IntegrationReason,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(`Integration stopped: ${code}.`);
    this.name = "IntegrationFailure";
  }
}
export function classifyStatus(
  status: number,
): "delivered" | "retry" | "dead_letter" {
  return status >= 200 && status < 300
    ? "delivered"
    : status === 408 || status === 429 || status >= 500
      ? "retry"
      : "dead_letter";
}
export function retryAfterMs(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const ms = /^\d+(\.\d+)?$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - now;
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 3_600_000) : undefined;
}
/** Equal jitter prevents synchronized workers; Retry-After is a lower bound. */
export function retryDelayMs(
  attempt: number,
  options: {
    baseMs?: number;
    capMs?: number;
    retryAfterMs?: number;
    random?: () => number;
  } = {},
) {
  const cap = options.capMs ?? 60_000;
  const backoff = Math.min(
    cap,
    (options.baseMs ?? 500) * 2 ** Math.min(Math.max(attempt - 1, 0), 20),
  );
  const random = Math.max(0, Math.min(1, (options.random ?? Math.random)()));
  return Math.ceil(
    Math.max(backoff / 2 + (random * backoff) / 2, options.retryAfterMs ?? 0),
  );
}
