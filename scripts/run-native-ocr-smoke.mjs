import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectRuntimeArtifacts, requireNativeOcrSuccess } from "./runtime-artifacts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "apps/api/dist");
const folder = resolve(output, "modules/ingestion/infrastructure/extraction");
const test = resolve(folder, "pdf-ocr.native.test.js");
const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", test], {
  cwd: root, encoding: "utf8", timeout: 125_000, maxBuffer: 1024 * 1024,
  env: { ...process.env, PDF_OCR_SMOKE_LANGUAGES: "eng+por" },
});
process.stdout.write(result.stdout ?? ""); process.stderr.write(result.stderr ?? "");
requireNativeOcrSuccess(result);
// Only these two smoke-only files were added to the clean production output.
await rm(test); await rm(resolve(folder, "pdf-test-fixture.js"));
console.log(JSON.stringify({ kind: "lumora.native-ocr-verified", passed: 2, skipped: 0, runtime: await inspectRuntimeArtifacts(output) }));
