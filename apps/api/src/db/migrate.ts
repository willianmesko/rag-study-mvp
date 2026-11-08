import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { createPostgresPool } from "../platform/database/pool.js";
import type { PoolClient } from "pg";

const migrationsDirectory = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const pool = createPostgresPool(config.DATABASE_URL, 10, "maintenance");
let currentMigration: string | undefined;

async function main(): Promise<void> {
  let client: PoolClient | undefined;
  try {
    const migrations = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    client = await pool.connect();
    // Bootstrap the tracker outside the individual migration transaction so the
    // first migration can also create the extension and application tables.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const filename of migrations) {
      const alreadyApplied = await client.query<{ version: string }>(
        "SELECT version FROM schema_migrations WHERE version = $1",
        [filename]
      );
      if (alreadyApplied.rowCount) continue;

      currentMigration = filename;
      const sql = await readFile(`${migrationsDirectory}/${filename}`, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [filename]);
        await client.query("COMMIT");
        console.log(`Applied ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client?.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const sqlState = typeof error === "object" && error !== null && "code" in error && "severity" in error &&
    typeof error.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) &&
    ["ERROR", "FATAL", "PANIC"].includes(String(error.severity)) ? error.code : undefined;
  const migration = currentMigration && /^\d{3,14}_[a-z0-9_-]+\.sql$/.test(currentMigration) ? currentMigration : undefined;
  console.error(JSON.stringify({ event: "database_migration_failed", reason: "migration_failed",
    ...(migration ? { migration } : {}), ...(sqlState ? { sqlState } : {}) }));
  process.exitCode = 1;
});

