import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createApplication } from "../../bootstrap.js";
import { config } from "../../config.js";

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npm run ingest -- path/to/document.md [source]");
  const path = resolve(file);
  const application = createApplication();
  try {
    const result = await application.useCases.ingestDocument.execute({
      tenantId: config.DEFAULT_TENANT_ID,
      source: process.argv[3] ?? `file://${path}`,
      title: basename(path),
      text: await readFile(path, "utf8"),
      metadata: { filename: basename(path) }
    });
    console.log(`Indexed ${result.chunkCount} chunks in document ${result.id}`);
  } finally {
    await application.close();
  }
}

main().catch((error: unknown) => {
  console.error("Ingestion failed:", error);
  process.exitCode = 1;
});

