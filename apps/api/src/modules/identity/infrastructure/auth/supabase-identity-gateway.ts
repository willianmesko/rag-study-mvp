import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  MemberDirectoryError,
  type IdentityVerifier,
  type IdentityVerification,
  type MemberDirectory,
} from "../../application/ports/identity-verifier.js";

export const maxAuthResponseBytes = 256 * 1024;
const userIdSchema = z.uuid();
const emailSchema = z.string().email().max(320);

/** Keep public token verification separate from the server-only directory client. */
export class SupabaseIdentityGateway implements IdentityVerifier, MemberDirectory {
  private readonly publicClient;
  private readonly adminClient;
  private readonly operation = new AsyncLocalStorage<AbortSignal>();
  private readonly timeoutMs: number;
  private readonly concurrency: number;

  constructor(options: {
    url?: string;
    publishableKey?: string;
    serviceRoleKey?: string;
    timeoutMs: number;
    directoryConcurrency?: number;
  }) {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
      throw new Error("Authentication timeout must be positive.");
    this.timeoutMs = options.timeoutMs;
    this.concurrency = options.directoryConcurrency ?? 4;
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 8)
      throw new Error("Member directory concurrency must be between one and eight.");
    const clientOptions = {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: this.fetch },
    };
    this.publicClient = options.url && options.publishableKey
      ? createClient(options.url, options.publishableKey, clientOptions) : null;
    this.adminClient = options.url && options.serviceRoleKey
      ? createClient(options.url, options.serviceRoleKey, clientOptions) : null;
  }

  async verify(token: string, signal?: AbortSignal): Promise<IdentityVerification> {
    if (!this.publicClient) return { ok: false, reason: "not_configured" };
    const deadline = this.deadline(signal);
    return this.operation.run(deadline, async () => {
      try {
        deadline.throwIfAborted();
        // Pass the token directly. Never set or persist a shared client session.
        const { data, error } = await this.publicClient!.auth.getUser(token);
        if (deadline.aborted) return { ok: false, reason: this.abortReason(deadline) };
        if (error) return { ok: false, reason: [400, 401, 403].includes(error.status ?? 0) ? "invalid_session" : "unavailable" };
        const userId = userIdSchema.safeParse(data.user?.id);
        return userId.success ? { ok: true, userId: userId.data } : { ok: false, reason: "unavailable" };
      } catch {
        return { ok: false, reason: deadline.aborted ? this.abortReason(deadline) : "unavailable" };
      }
    });
  }

  async emailsForMembers(userIds: readonly string[], signal?: AbortSignal): Promise<ReadonlyMap<string, string | null>> {
    if (!this.adminClient) throw new MemberDirectoryError("not_configured");
    const ids = [...new Set(userIds)];
    if (ids.some((id) => !userIdSchema.safeParse(id).success)) throw new MemberDirectoryError("unavailable");
    const cancel = new AbortController();
    const deadline = this.deadline(signal, cancel.signal);
    return this.operation.run(deadline, async () => {
      const emails = new Map<string, string | null>();
      let next = 0;
      const worker = async () => {
        while (next < ids.length) {
          if (deadline.aborted) throw new MemberDirectoryError(this.abortReason(deadline));
          const id = ids[next++];
          const { data, error } = await this.adminClient!.auth.admin.getUserById(id);
          if (deadline.aborted) throw new MemberDirectoryError(this.abortReason(deadline));
          // A removed identity must not turn into an unrelated account or fail the list.
          if (error?.status === 404) { emails.set(id, null); continue; }
          if (error || data.user?.id !== id) throw new MemberDirectoryError("unavailable");
          const email = emailSchema.safeParse(data.user.email);
          emails.set(id, email.success ? email.data : null);
        }
      };
      const workers = Array.from({ length: Math.min(this.concurrency, ids.length) }, worker);
      try {
        await Promise.all(workers);
        return emails;
      } catch (error) {
        cancel.abort();
        await Promise.allSettled(workers);
        throw error instanceof MemberDirectoryError ? error : new MemberDirectoryError("unavailable");
      }
    });
  }

  private deadline(...signals: Array<AbortSignal | undefined>): AbortSignal {
    return AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...signals.filter((signal): signal is AbortSignal => Boolean(signal))]);
  }

  private abortReason(signal: AbortSignal): "timeout" | "cancelled" {
    return signal.reason instanceof Error && signal.reason.name === "TimeoutError" ? "timeout" : "cancelled";
  }

  private fetch: typeof fetch = async (input, init) => {
    const signal = this.operation.getStore() ?? this.deadline();
    const combined = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
    try {
      combined.throwIfAborted();
      const pending = fetch(input, { ...init, signal: combined, redirect: "error" });
      void pending.then((response) => {
        if (combined.aborted) void response.body?.cancel().catch(() => {});
      }, () => {});
      const response = await this.untilAbort(pending, combined);
      if (!response.body) return response;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await this.untilAbort(reader.read(), combined);
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxAuthResponseBytes) throw new Error("Authentication response exceeds its size limit.");
          chunks.push(value);
        }
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      return new Response(Buffer.concat(chunks, bytes), { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch {
      // auth-js logs rejected fetch errors. Return a safe response so provider
      // messages, URLs, tokens and user data never reach that logging path.
      return Response.json({ message: "Authentication service unavailable." }, { status: 503 });
    }
  };

  private async untilAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    let abort!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    });
    try { return await Promise.race([pending, interrupted]); }
    finally { signal.removeEventListener("abort", abort); }
  }
}
