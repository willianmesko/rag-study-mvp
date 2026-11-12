import {
  startTelemetry,
  OpenTelemetryObserver,
} from "./app/observability/telemetry.js";
import { setOperationalObserver } from "./platform/observability/observer.js";
import { config } from "./config.js";
import { createNestHttpServer } from "./app/nest/bootstrap.js";
import { createShutdownCoordinator, type ShutdownReason } from "./platform/lifecycle/shutdown.js";

async function main(): Promise<void> {
  const telemetry = startTelemetry({
    enabled: config.OTEL_ENABLED,
    endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
    metricsEndpoint: config.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
  });
  setOperationalObserver(
    new OpenTelemetryObserver((event) =>
      process.stdout.write(JSON.stringify(event) + "\n"),
    ),
  );
  const runtime = await createNestHttpServer(config, { isProduction: process.env.NODE_ENV === "production" });
  const application = runtime.application!;
  const app = runtime.fastify;
  let processing: Promise<void> | undefined;
  let pruning: Promise<void> | undefined;
  const lifecycle = createShutdownCoordinator({
    timeoutMs: config.SERVER_SHUTDOWN_TIMEOUT_MS,
    stopBackground: () => { clearInterval(worker); clearInterval(cleanup); },
    closeHttp: () => app.close(),
    drain: async () => { await Promise.allSettled([processing, pruning]); },
    closeResources: () => runtime.nest.close(),
    flushTelemetry: () => telemetry.shutdown(),
    report: (event) => app.log.info(event, "Server shutdown."),
  });
  const worker = setInterval(() => {
    if (processing || lifecycle.signal.aborted) return;
    processing = application.useCases.processNextIngestionJob
      .execute(lifecycle.signal)
      .then(() => undefined)
      .catch((error: unknown) => {
        if (!lifecycle.signal.aborted) app.log.error({ code: "ingestion_worker_failed", err: error }, "Ingestion worker failed.");
      })
      .finally(() => {
        processing = undefined;
      });
  }, config.INGESTION_WORKER_INTERVAL_MS);
  const cleanup = setInterval(() => {
    if (pruning || lifecycle.signal.aborted) return;
    pruning = application.useCases.chatRuns
      .pruneExpired()
      .then(async () => {
        await application.useCases.workflows?.repository.prune();
        await application.useCases.pruneInvitationDeliveries();
      })
      .catch((error: unknown) => {
        if (!lifecycle.signal.aborted) app.log.error({ code: "retention_cleanup_failed", err: error }, "Chat replay cleanup failed.");
      })
      .finally(() => {
        pruning = undefined;
      });
  }, 60_000);
  const shutdown = async (signal: ShutdownReason): Promise<void> => {
    const result = await lifecycle.shutdown(signal);
    process.exit(result.code);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (error) {
    if (!lifecycle.requested) app.log.error({ code: "server_start_failed", err: error }, "Server startup failed.");
    await shutdown("startup_failure");
  }
}

main().catch(() => {
  console.error(JSON.stringify({ event: "server_start_failed", reason: "startup_failed" }));
  process.exit(1);
});
