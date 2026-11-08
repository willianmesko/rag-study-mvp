import type { ClientBase, Pool, PoolClient } from "pg";
import { recordPostgresCheckout } from "./checkout-metrics.js";

export const postgresDeadlineProfiles = {
  runtime: { statementMs: 30_000, lockMs: 3_000, idleTransactionMs: 30_000 },
  retrieval: { statementMs: 2_000, lockMs: 500, idleTransactionMs: 2_000 },
  maintenance: { statementMs: 600_000, lockMs: 10_000, idleTransactionMs: 60_000 },
} as const;
export type PostgresWorkload = keyof typeof postgresDeadlineProfiles;
export type PostgresDeadlines = {
  statementMs: number;
  lockMs: number;
  idleTransactionMs: number;
};

const poolWorkloads = new WeakMap<Pool, PostgresWorkload>();
export function setPostgresWorkload(pool: Pool, workload: PostgresWorkload) {
  poolWorkloads.set(pool, workload);
}

/** pg_settings normalizes all three duration settings to milliseconds. A role,
 * database or DSN limit must never be relaxed by an application workload cap. */
export async function applyPostgresDeadlines(
  client: ClientBase,
  limits: PostgresDeadlines,
  local: boolean,
) {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
      throw new Error("PostgreSQL deadlines require bounded millisecond values.");
  }
  const result = await client.query(
    `SELECT pg_catalog.set_config(setting.name,
       CASE WHEN setting.setting::bigint=0 OR setting.setting::bigint>cap.milliseconds
         THEN cap.milliseconds::text ELSE setting.setting END,$4)
     FROM pg_catalog.pg_settings setting
     JOIN (VALUES ('statement_timeout',$1::int),('lock_timeout',$2::int),
       ('idle_in_transaction_session_timeout',$3::int)) cap(name,milliseconds)
       ON cap.name=setting.name WHERE setting.unit='ms'`,
    [limits.statementMs, limits.lockMs, limits.idleTransactionMs, local],
  );
  if (result.rowCount !== 3)
    throw new Error("PostgreSQL deadline configuration is unavailable.");
}

/** Awaited by pg's onConnect hook before a new client can serve any query. */
export async function initializePostgresDeadlines(
  client: ClientBase,
  workload: PostgresWorkload,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      applyPostgresDeadlines(client, postgresDeadlineProfiles[workload], false),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          // pg-pool destroys the client when its awaited onConnect hook rejects,
          // including a socket still executing this settings query. It is never
          // handed to the waiting caller or admitted as an idle connection.
          reject(new Error("PostgreSQL deadline setup timed out."));
        }, 1_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** pg has no AbortSignal checkout API. Reject promptly and release a late
 * acquisition without ever submitting the cancelled operation to PostgreSQL. */
export function acquirePostgresClient(pool: Pool, signal: AbortSignal): Promise<PoolClient> {
  signal.throwIfAborted();
  const started = performance.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (reason: unknown, outcome: "cancelled" | "failed") => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      recordPostgresCheckout(outcome, started);
      reject(reason);
    };
    const abort = () => fail(signal.reason, "cancelled");
    signal.addEventListener("abort", abort, { once: true });
    let pending: Promise<PoolClient>;
    try { pending = pool.connect(); }
    catch (error) { fail(error, "failed"); return; }
    pending.then((client) => {
      signal.removeEventListener("abort", abort);
      if (settled || signal.aborted) {
        client.release();
        if (!settled) abort();
        return;
      }
      settled = true;
      recordPostgresCheckout("acquired", started);
      resolve(client);
    }, (error: unknown) => {
      fail(error, "failed");
    });
    if (signal.aborted) abort();
  });
}

/** Same-client transaction, local workload caps, bounded checkout and cleanup.
 * Read-only boundaries retain repeatable-read isolation; writes retain the
 * default isolation and the caller's own authorization/fencing SQL. */
export async function withPostgresTransaction<Result>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<Result>,
  options: {
    signal?: AbortSignal;
    workload?: PostgresWorkload;
    limits?: PostgresDeadlines;
    readOnly?: boolean;
  } = {},
): Promise<Result> {
  const limits = options.limits ?? postgresDeadlineProfiles[
    options.workload ?? poolWorkloads.get(pool) ?? "runtime"
  ];
  // Server statement/lock limits are primary. This outer deadline also bounds
  // checkout, transaction setup, rollback and lost client/network responses.
  const deadline = AbortSignal.timeout(Math.min(Math.max(1_000, limits.statementMs * 3), 2_147_483_647));
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const client = await acquirePostgresClient(pool, signal);
  let discarded = false;
  const discard = () => {
    if (discarded) return;
    discarded = true;
    // release(true) evicts and closes the socket. Local server-side deadlines
    // remain necessary when a transaction pooler keeps a backend alive.
    client.release(true);
  };
  let interrupt!: (error: unknown) => void;
  const interrupted = new Promise<never>((_resolve, reject) => { interrupt = reject; });
  const abort = () => { discard(); interrupt(signal.reason); };
  const clientFailed = (error: Error) => { discard(); interrupt(error); };
  signal.addEventListener("abort", abort, { once: true });
  // A fatal idle-in-transaction timeout can arrive between statements. Handle
  // checked-out client errors too; pool idle-client listeners do not run here.
  client.on("error", clientFailed);
  const run = async () => {
    signal.throwIfAborted();
    await client.query(options.readOnly
      ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
      : "BEGIN");
    signal.throwIfAborted();
    await applyPostgresDeadlines(client, limits, true);
    signal.throwIfAborted();
    const result = await operation(client);
    signal.throwIfAborted();
    await client.query("COMMIT");
    signal.throwIfAborted();
    return result;
  };
  try {
    if (signal.aborted) abort();
    return await Promise.race([run(), interrupted]);
  } catch (error) {
    if (signal.aborted) discard();
    if (!discarded) {
      try { await client.query("ROLLBACK"); }
      catch { discard(); }
    }
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    client.removeListener("error", clientFailed);
    if (!discarded) client.release();
  }
}
