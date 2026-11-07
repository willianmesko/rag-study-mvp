import {
  startTelemetry,
  OpenTelemetryObserver,
} from "./infrastructure/observability/telemetry.js";
import { setOperationalObserver } from "./application/observability.js";
import { config } from "./config.js";
import { createApplication } from "./bootstrap.js";
import { buildApp } from "./interfaces/http/app.js";

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
  const application = createApplication();
  const app = await buildApp(application.useCases);
  let processing: Promise<void> | undefined;
  const worker = setInterval(() => {
    if (processing) return;
    processing = application.useCases.processNextIngestionJob
      .execute()
      .then(() => undefined)
      .catch((error: unknown) =>
        app.log.error(error, "Ingestion worker failed."),
      )
      .finally(() => {
        processing = undefined;
      });
  }, config.INGESTION_WORKER_INTERVAL_MS);
  let pruning: Promise<void> | undefined;
  const cleanup = setInterval(() => {
    if (pruning) return;
    pruning = application.useCases.chatRuns
      .pruneExpired()
      .then(async () => {
        await application.useCases.workflows?.repository.prune();
        await application.useCases.pruneInvitationDeliveries();
      })
      .catch((error: unknown) =>
        app.log.error(error, "Chat replay cleanup failed."),
      )
      .finally(() => {
        pruning = undefined;
      });
  }, 60_000);
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}; shutting down.`);
    clearInterval(worker);
    clearInterval(cleanup);
    await processing;
    await app.close();
    await pruning;
    await application.close();
    await telemetry.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (error) {
    app.log.error(error);
    clearInterval(worker);
    clearInterval(cleanup);
    await processing;
    await app.close();
    await pruning;
    await application.close();
    await telemetry.shutdown();
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("Unable to start server:", error);
  process.exit(1);
});
