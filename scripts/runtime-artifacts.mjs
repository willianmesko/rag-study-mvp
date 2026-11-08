import { lstat, readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { createHash } from "node:crypto";

// The compiler roots are the single source of truth for supported entry paths.
const roots = JSON.parse(readFileSync(new URL("../apps/api/tsconfig.runtime.json", import.meta.url), "utf8")).files;
if (!Array.isArray(roots) || roots.length === 0 || roots.some((file) => typeof file !== "string" || !/^src\/[a-zA-Z0-9_/-]+\.ts$/.test(file)))
  throw new Error("Explicit production compiler roots are required.");
export const runtimeEntries = Object.freeze(roots.map((file) => file.slice(4).replace(/\.ts$/, ".js")));
const forbidden = /(?:\.test\.|\.spec\.|test-fixture\.)/;

/** Inspect only Lumora's emitted application tree, not third-party package contents. */
export async function inspectRuntimeArtifacts(directory) {
  const root = resolve(directory), files = [];
  async function visit(path) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error("Runtime artifacts must not contain symbolic links.");
    if (stat.isDirectory()) {
      for (const name of await readdir(path)) await visit(resolve(path, name));
      return;
    }
    if (!stat.isFile()) throw new Error("Unexpected runtime artifact type.");
    const name = relative(root, path).replaceAll("\\", "/");
    if (forbidden.test(name)) throw new Error("Test-only files are present in the runtime tree.");
    if (name.endsWith(".js")) {
      const content = await readFile(path, "utf8");
      if (/\b(?:from\s*|import\s*\(|require\s*\()\s*["'](?:node:test|@playwright\/test)["']/.test(content))
        throw new Error("A runtime module imports a test runner.");
    }
    files.push({ name, bytes: stat.size });
  }
  await visit(root);
  const names = new Set(files.map(({ name }) => name));
  if (runtimeEntries.some((entry) => !names.has(entry))) throw new Error("A supported runtime entry is missing.");
  return { files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), entries: runtimeEntries.length, testArtifacts: 0 };
}

export function requireNativeOcrSuccess(result) {
  if (result.error || result.status !== 0 || result.signal ||
    !/^# tests 2\s*$/m.test(result.stdout ?? "") || !/^# pass 2\s*$/m.test(result.stdout ?? "") || !/^# skipped 0\s*$/m.test(result.stdout ?? ""))
    throw new Error("Both native OCR cases must pass with zero skips.");
}

/** SQL assets live beside dist; their bytes must match the reviewed catalog. */
export async function inspectMigrationResources(directory) {
  const versions = (await readdir(directory)).sort(), digest = createHash("sha256");
  if (!versions.length) throw new Error("The runtime migration catalog is missing.");
  let bytes = 0;
  for (const name of versions) {
    if (!/^\d{3,14}_[a-z0-9_-]+\.sql$/.test(name)) throw new Error("Unexpected migration resource name.");
    const path = resolve(directory, name), stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Migration resources must be regular SQL files.");
    const content = await readFile(path);
    bytes += content.byteLength;
    digest.update(name).update("\0").update(content).update("\0");
  }
  return { files: versions.length, bytes, sha256: digest.digest("hex"), versions };
}
