export type ShutdownReason = "SIGINT" | "SIGTERM" | "startup_failure";
export type ShutdownStage = "background" | "http" | "drain" | "resources" | "telemetry";
export type ShutdownResult = { code: 0 | 1; outcome: "completed" | "failed" | "timeout"; failedStages: ShutdownStage[] };

type Operations = {
  timeoutMs: number;
  stopBackground: () => void;
  closeHttp: () => Promise<unknown>;
  drain: () => Promise<unknown>;
  closeResources: () => Promise<unknown>;
  flushTelemetry: () => Promise<unknown>;
  report?: (event: { event: "server_shutdown"; reason: ShutdownReason; outcome: ShutdownResult["outcome"] | "started"; stage?: ShutdownStage }) => void;
};

/** One owned shutdown across repeated signals. Drain gets 80% of the budget;
 * cleanup always starts and receives the remaining time. The executable exits
 * with the returned code so an uncooperative provider cannot hold it forever. */
export function createShutdownCoordinator(operations: Operations) {
  if (!Number.isInteger(operations.timeoutMs) || operations.timeoutMs < 1 || operations.timeoutMs > 25_000)
    throw new Error("Shutdown requires a bounded timeout of at most 25 seconds.");
  const controller = new AbortController();
  let requested: Promise<ShutdownResult> | undefined;
  const report = (event: Parameters<NonNullable<Operations["report"]>>[0]) => {
    try { operations.report?.(event); } catch { /* Diagnostics cannot prevent cleanup. */ }
  };

  function shutdown(reason: ShutdownReason): Promise<ShutdownResult> {
    if (requested) return requested;
    let resolve!: (result: ShutdownResult) => void;
    // Assign before invoking callbacks: an error/signal raised by a callback
    // cannot recursively start another shutdown.
    requested = new Promise((done) => { resolve = done; });
    const run = async (): Promise<ShutdownResult> => {
      const started = performance.now();
      const failed = new Set<ShutdownStage>();
      let timedOut = false;
      const attempt = async (stage: ShutdownStage, operation: () => unknown) => {
        try { await operation(); }
        catch { failed.add(stage); report({ event: "server_shutdown", reason, outcome: "failed", stage }); }
      };
      report({ event: "server_shutdown", reason, outcome: "started" });
      await attempt("background", operations.stopBackground);
      const httpClosing = attempt("http", operations.closeHttp);
      controller.abort(new Error("Server shutdown."));
      const draining = Promise.all([
        httpClosing,
        attempt("drain", operations.drain),
      ]);
      try {
        timedOut = !await settleWithin(draining, Math.floor(operations.timeoutMs * 0.8));
      } finally {
        // Run independent cleanup even when a previous stage never resolves.
        const cleanup = Promise.all([
          attempt("resources", operations.closeResources),
          attempt("telemetry", operations.flushTelemetry),
        ]);
        const remaining = Math.max(0, operations.timeoutMs - (performance.now() - started));
        if (!await settleWithin(cleanup, remaining)) timedOut = true;
      }
      const outcome = timedOut ? "timeout" : failed.size || reason === "startup_failure" ? "failed" : "completed";
      report({ event: "server_shutdown", reason, outcome });
      return { code: outcome === "completed" ? 0 : 1, outcome, failedStages: [...failed] };
    };
    // Callbacks are contained above; this final guard also makes a programming
    // error settle the executable's shutdown promise instead of hanging it.
    void run().then(resolve, () => resolve({ code: 1, outcome: "failed", failedStages: [] }));
    return requested;
  }
  return { signal: controller.signal, shutdown, get requested() { return Boolean(requested); } };
}

async function settleWithin(work: Promise<unknown>, milliseconds: number): Promise<boolean> {
  if (milliseconds <= 0) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
