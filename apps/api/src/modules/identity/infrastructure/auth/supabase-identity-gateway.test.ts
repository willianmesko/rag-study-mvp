import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { MemberDirectoryError } from "../../application/ports/identity-verifier.js";
import { SupabaseIdentityGateway, maxAuthResponseBytes } from "./supabase-identity-gateway.js";

const url = "https://identity.example.test";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const options = { url, publishableKey: "public-fixture", serviceRoleKey: "admin-fixture", timeoutMs: 1000 };

async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const guard = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Test exceeded authentication deadline.")), 1500); });
  try { return await Promise.race([work, guard]); }
  finally { clearTimeout(timer); }
}

test("concurrent token checks use the public client without mutating a shared session or trusting role metadata", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    assert.equal(String(input), `${url}/auth/v1/user`);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), options.publishableKey);
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    const token = headers.get("authorization")!;
    calls.push(token);
    await delay(token === "Bearer first" ? 3 : 1);
    return Response.json({ id: token === "Bearer first" ? id(1) : id(2), aud: "authenticated", user_metadata: { role: "owner", private: "PRIVATE_SENTINEL" } });
  });
  const gateway = new SupabaseIdentityGateway(options);
  assert.deepEqual(await Promise.all([gateway.verify("first"), gateway.verify("second")]), [{ ok: true, userId: id(1) }, { ok: true, userId: id(2) }]);
  assert.deepEqual(calls, ["Bearer first", "Bearer second"]);
});

test("invalid sessions remain distinct from provider failures and raw transport data is never logged", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  let status = 401;
  t.mock.method(globalThis, "fetch", async () => {
    if (!status) throw new TypeError("PRIVATE_NETWORK_SENTINEL token=secret");
    return Response.json({ message: "PRIVATE_AUTH_SENTINEL" }, { status });
  });
  const gateway = new SupabaseIdentityGateway(options);
  for (status of [400, 401, 403]) assert.deepEqual(await gateway.verify("session"), { ok: false, reason: "invalid_session" });
  for (status of [429, 500, 503, 0]) assert.deepEqual(await gateway.verify("session"), { ok: false, reason: "unavailable" });
  assert.equal(logged.mock.callCount(), 0);
});

test("the authentication deadline bounds stalled headers and stalled bodies and aborts the underlying read", async (t) => {
  for (const stalled of ["headers", "body"] as const) {
    let signal: AbortSignal | null | undefined, cancelled = false;
    t.mock.method(globalThis, "fetch", async (_input: string, init?: RequestInit) => {
      signal = init?.signal;
      if (stalled === "headers") return new Promise<Response>((_resolve, reject) => signal!.addEventListener("abort", () => { cancelled = true; reject(new Error("PRIVATE_ABORT_SENTINEL")); }, { once: true }));
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode('{"id":')); },
        cancel() { cancelled = true; },
      }));
    });
    const gateway = new SupabaseIdentityGateway({ ...options, timeoutMs: 20 });
    assert.deepEqual(await bounded(gateway.verify("session")), { ok: false, reason: "timeout" });
    assert.equal(signal?.aborted, true);
    assert.equal(cancelled, true);
  }
});

test("oversized and malformed identities fail closed, and already cancelled checks never call Auth", async (t) => {
  let oversized = true, cancelled = false;
  const fetch = t.mock.method(globalThis, "fetch", async () => oversized
    ? new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(maxAuthResponseBytes + 1)); }, cancel() { cancelled = true; },
    }))
    : Response.json({ id: "invalid-user-id", aud: "authenticated" }));
  const gateway = new SupabaseIdentityGateway(options);
  assert.deepEqual(await gateway.verify("session"), { ok: false, reason: "unavailable" });
  assert.equal(cancelled, true);
  oversized = false;
  assert.deepEqual(await gateway.verify("session"), { ok: false, reason: "unavailable" });
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await gateway.verify("session", controller.signal), { ok: false, reason: "cancelled" });
  assert.equal(fetch.mock.callCount(), 2);
});

test("member projection finds accounts beyond the old first thousand without listing unrelated users", async (t) => {
  const users = new Map(Array.from({ length: 1005 }, (_, n) => [id(n), { id: id(n), email: `member-${n}@example.test`, app_metadata: { private: "PRIVATE_DIRECTORY_SENTINEL" } }]));
  const fetched: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    const memberId = new URL(String(input)).pathname.split("/").at(-1)!;
    assert.equal(String(input), `${url}/auth/v1/admin/users/${memberId}`);
    assert.equal(new Headers(init?.headers).get("apikey"), options.serviceRoleKey);
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${options.serviceRoleKey}`);
    fetched.push(memberId);
    return Response.json(users.get(memberId));
  });
  const gateway = new SupabaseIdentityGateway(options);
  const emails = await gateway.emailsForMembers([id(10), id(1004), id(10)]);
  assert.deepEqual([...emails], [[id(10), "member-10@example.test"], [id(1004), "member-1004@example.test"]]);
  assert.deepEqual(fetched, [id(10), id(1004)]);
});

test("directory lookups share one deadline and bounded concurrency and retain missing identities as null", async (t) => {
  let active = 0, maximum = 0;
  const signals = new Set<AbortSignal | null | undefined>();
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    maximum = Math.max(maximum, ++active);
    signals.add(init?.signal);
    await delay(2);
    active--;
    const memberId = new URL(String(input)).pathname.split("/").at(-1)!;
    return memberId === id(9) ? Response.json({ message: "User not found" }, { status: 404 }) : Response.json({ id: memberId, email: "member@example.test" });
  });
  const gateway = new SupabaseIdentityGateway({ ...options, directoryConcurrency: 3 });
  const emails = await gateway.emailsForMembers(Array.from({ length: 10 }, (_, n) => id(n)));
  assert.equal(emails.size, 10);
  assert.equal(emails.get(id(9)), null);
  assert.equal(maximum, 3);
  assert.equal(signals.size, 1);
});

test("a stalled member batch aborts all in-flight calls without launching the rest", async (t) => {
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, "fetch", async (_input: string, init?: RequestInit) => {
    const signal = init!.signal!; signals.push(signal);
    return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("PRIVATE_DIRECTORY_SENTINEL")), { once: true }));
  });
  const gateway = new SupabaseIdentityGateway({ ...options, timeoutMs: 20, directoryConcurrency: 2 });
  await assert.rejects(bounded(gateway.emailsForMembers(Array.from({ length: 10 }, (_, n) => id(n)))), (error) => error instanceof MemberDirectoryError && error.reason === "timeout");
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal.aborted));
});

test("directory results cannot substitute another account, and missing client configuration never makes requests", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ id: id(2), email: "unrelated@example.test" }));
  await assert.rejects(new SupabaseIdentityGateway(options).emailsForMembers([id(1)]), (error) => error instanceof MemberDirectoryError && error.reason === "unavailable");
  const absent = new SupabaseIdentityGateway({ timeoutMs: 1000 });
  assert.deepEqual(await absent.verify("session"), { ok: false, reason: "not_configured" });
  await assert.rejects(absent.emailsForMembers([id(1)]), (error) => error instanceof MemberDirectoryError && error.reason === "not_configured");
  assert.equal(fetch.mock.callCount(), 1);
});
