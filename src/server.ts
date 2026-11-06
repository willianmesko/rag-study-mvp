import { config } from "./config.js";
import { createApplication } from "./bootstrap.js";
import { buildApp } from "./interfaces/http/app.js";

async function main(): Promise<void> {
  const application = createApplication();
  const app = await buildApp(application.useCases);
  let processing = false;
  const worker = setInterval(() => {
    if (processing) return;
    processing = true;
    void application.useCases.processNextIngestionJob.execute().finally(() => { processing = false; });
  }, config.INGESTION_WORKER_INTERVAL_MS);
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}; shutting down.`);
    clearInterval(worker);
    await app.close();
    await application.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (error) {
    app.log.error(error);
    await app.close();
    await application.close();
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("Unable to start server:", error);
  process.exit(1);
});

