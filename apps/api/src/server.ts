import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { createApplication } from "./bootstrap.js";
import { buildApp } from "./interfaces/http/app.js";

async function allowHtmlOriginals(): Promise<void> {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, SUPABASE_UPLOAD_BUCKET: name } = config;
  if (!url || !key) throw new Error("Private storage is not configured.");
  const signal = AbortSignal.timeout(8_000);
  const { storage } = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal }) }
  });
  const { data: bucket, error } = await storage.getBucket(name);
  if (error || !bucket || bucket.public !== false || !Number.isSafeInteger(bucket.file_size_limit)) {
    throw new Error("Could not verify the private originals bucket and its limit.");
  }
  const allowedMimeTypes = bucket.allowed_mime_types;
  if (!allowedMimeTypes || allowedMimeTypes.includes("text/html")) return;
  const updated = await storage.updateBucket(name, {
    public: false,
    fileSizeLimit: bucket.file_size_limit,
    allowedMimeTypes: [...allowedMimeTypes, "text/html"]
  });
  if (updated.error) throw new Error("Could not update the originals bucket.");
}

async function main(): Promise<void> {
  const application = createApplication();
  const app = await buildApp(application.useCases);
  if (process.env.LUMORA_ALLOW_HTML_ORIGINALS === "true") {
    try {
      await allowHtmlOriginals();
      app.log.info("The private originals bucket permits HTML.");
    } catch {
      app.log.error("Could not configure HTML uploads in private storage.");
    }
  }
  let processing = false;
  const worker = setInterval(() => {
    if (processing) return;
    processing = true;
    void application.useCases.processNextIngestionJob.execute()
      .catch((error: unknown) => app.log.error(error, "Ingestion worker failed."))
      .finally(() => { processing = false; });
  }, config.INGESTION_WORKER_INTERVAL_MS);
  let pruning: Promise<void> | undefined;
  const cleanup = setInterval(() => {
    if (pruning) return;
    pruning = application.useCases.chatRuns.pruneExpired()
      .then(() => undefined)
      .catch((error: unknown) => app.log.error(error, "Chat replay cleanup failed."))
      .finally(() => { pruning = undefined; });
  }, 60_000);
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}; shutting down.`);
    clearInterval(worker);
    clearInterval(cleanup);
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

