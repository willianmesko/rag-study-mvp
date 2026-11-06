import { config } from "./config.js";
import { createApplication } from "./bootstrap.js";
import { buildApp } from "./interfaces/http/app.js";

async function main(): Promise<void> {
  const application = createApplication();
  const app = await buildApp(application.useCases);
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}; shutting down.`);
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

