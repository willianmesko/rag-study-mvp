import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { productionFiles, inspectComputedImports } from "./architecture-source.mjs";

export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
export const installedCruiser = path.join(repositoryRoot, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs");

export async function checkArchitecture({ root = repositoryRoot, cruiser = installedCruiser, write = (value) => process.stdout.write(value) } = {}) {
  const files = await productionFiles(root);
  if (!files.length) {
    write("Architecture check failed: no production source files found.\n");
    return 1;
  }
  const findings = await inspectComputedImports(root, files);
  for (const item of findings)
    write(`${item.file}:${item.line}:${item.column} computed-dynamic-import: use a literal module target.\n`);
  try { await access(cruiser); }
  catch {
    write("Architecture checker is unavailable. Install the reviewed development dependencies with npm ci.\n");
    return 1;
  }
  let failed = findings.length > 0;
  for (const pass of ["structural", "runtime"]) {
    const result = spawnSync(process.execPath, [cruiser, ...files, "--config",
      path.join(repositoryRoot, `architecture.${pass}.cjs`), "--output-type", "err"],
    { cwd: root, encoding: "utf8", timeout: 30_000 });
    write(`Architecture ${pass} pass\n${result.stdout ?? ""}${result.stderr ?? ""}`);
    if (result.error) write(`Architecture checker could not finish: ${result.error.code ?? "spawn_failed"}.\n`);
    if (result.error || result.status !== 0) failed = true;
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await checkArchitecture();
