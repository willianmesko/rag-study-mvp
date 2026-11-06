import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { createPostgresPool } from "../infrastructure/postgres/pool.js";

const migrationsDirectory = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const pool = createPostgresPool(config.DATABASE_URL);

async function main(): Promise<void> {
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const client = await pool.connect();
  try {
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
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});

