import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { inspectRuntimeArtifacts, inspectMigrationResources } from "./runtime-artifacts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "apps/api/dist");
await rm(output, { recursive: true, force: true });
const build = spawnSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", "apps/api/tsconfig.runtime.json"], { cwd: root, stdio: "inherit" });
if (build.error || build.status !== 0 || build.signal) process.exit(build.status || 1);
console.log(JSON.stringify({ kind: "lumora.api-runtime", ...await inspectRuntimeArtifacts(output),
  migrations: await inspectMigrationResources(resolve(root, "apps/api/db/migrations")) }));
