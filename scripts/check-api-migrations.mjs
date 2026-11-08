import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { inspectMigrationResources } from "./runtime-artifacts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { Pool } = require("pg");
const image = process.env.API_TEST_IMAGE ?? "lumora-api:ci";
const databaseUrl = process.env.RUNTIME_MIGRATION_TEST_DATABASE_URL;
let stage = "fixture_validation";
const docker = (args) => execFileSync("docker", args, { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });

async function main() {
  assert.ok(databaseUrl, "A dedicated runtime-migration fixture is required.");
  const url = new URL(databaseUrl);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    /^\/runtime_artifact_[a-z0-9_]+$/.test(url.pathname), "Use only a dedicated disposable loopback database.");
  assert.match(image, /^lumora-api:[a-z0-9_.-]{1,80}$/);
  const catalog = await inspectMigrationResources(resolve(root, "apps/api/db/migrations"));
  stage = "image_catalog";
  const receipt = JSON.parse(docker(["run", "--rm", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
    "--mount", `type=bind,src=${resolve(root, "scripts/runtime-artifacts.mjs")},dst=/app/scripts/runtime-artifacts.mjs,readonly`,
    "--mount", `type=bind,src=${resolve(root, "apps/api/tsconfig.runtime.json")},dst=/app/apps/api/tsconfig.runtime.json,readonly`,
    "--entrypoint=node", image, "--input-type=module", "--eval",
    "import {inspectRuntimeArtifacts,inspectMigrationResources} from './scripts/runtime-artifacts.mjs'; console.log(JSON.stringify({runtime:await inspectRuntimeArtifacts('./apps/api/dist'),migrations:await inspectMigrationResources('./apps/api/db/migrations')}));"]));
  assert.deepEqual(receipt.migrations, catalog);
  stage = "fresh_database";
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  let poolFault = false; pool.on("error", () => { poolFault = true; });
  try {
    const empty = await pool.query("SELECT to_regclass('public.schema_migrations') AS tracker");
    assert.equal(empty.rows[0].tracker, null, "The image check requires a fresh fixture.");
    const migrate = () => docker(["run", "--rm", "--network=host", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
      "--env", `DATABASE_URL=${databaseUrl}`, "--entrypoint=node", image, "apps/api/dist/db/migrate.js"]);
    stage = "first_migration";
    const first = migrate();
    const applied = [...first.matchAll(/^Applied (.+\.sql)$/gm)].map((match) => match[1]);
    assert.deepEqual(applied, catalog.versions);
    stage = "second_migration";
    assert.doesNotMatch(migrate(), /^Applied /m);
    const tracked = await pool.query("SELECT version FROM schema_migrations ORDER BY version");
    assert.deepEqual(tracked.rows.map(({ version }) => version), catalog.versions);
    assert.equal(poolFault, false);
    console.log(JSON.stringify({ kind: "lumora.api-image-migrations", passed: true, catalogFiles: catalog.files,
      catalogBytes: catalog.bytes, catalogSha256: catalog.sha256, firstRunApplied: applied.length, secondRunApplied: 0,
      trackerVersions: tracked.rowCount, readOnlyContainer: true, runtime: receipt.runtime }));
  } finally { await pool.end(); }
}

main().catch(() => { console.error(JSON.stringify({ kind: "lumora.api-image-migrations", passed: false, stage })); process.exitCode = 1; });
