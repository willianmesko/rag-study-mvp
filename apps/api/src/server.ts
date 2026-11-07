import { config } from "./config.js";
import { createApplication } from "./bootstrap.js";
import { buildApp } from "./interfaces/http/app.js";

async function main(): Promise<void> {
  const application = createApplication();
  const app = await buildApp(application.useCases);
  let processing: Promise<void> | undefined;
  const worker = setInterval(() => {
    if (processing) return;
    processing = application.useCases.processNextIngestionJob.execute()
      .then(() => undefined)
      .catch((error: unknown) => app.log.error(error, "Ingestion worker failed."))
      .finally(() => { processing = undefined; });
  }, config.INGESTION_WORKER_INTERVAL_MS);
  let pruning: Promise<void> | undefined;
  const cleanup = setInterval(() => {
    if (pruning) return;
    pruning = application.useCases.chatRuns.pruneExpired()
      .then(async () => { await application.useCases.workflows?.repository.prune(); })
      .catch((error: unknown) => app.log.error(error, "Chat replay cleanup failed."))
      .finally(() => { pruning = undefined; });
  }, 60_000);
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}; shutting down.`);
    clearInterval(worker);
    clearInterval(cleanup);
    await processing;
    await app.close();
    await pruning;
    await application.close();
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
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("Unable to start server:", error);
  process.exit(1);
});

