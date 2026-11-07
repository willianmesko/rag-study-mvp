import { Pool } from "pg";
import { metrics } from "@opentelemetry/api";

export function createPostgresPool(databaseUrl: string, max = 10): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });
  const faults = metrics.getMeter("lumora.database", "1.0").createCounter("lumora.database.pool.errors");
  pool.on("error", () => {
    // pg removes the failed idle client itself. Handle the event so a temporary
    // connection fault cannot become an unhandled EventEmitter exception.
    try { faults.add(1, { reason: "idle_connection_error" }); } catch { /* Diagnostics must not terminate the process. */ }
    try { console.warn(JSON.stringify({ event: "database_pool_fault", reason: "idle_connection_error" })); } catch { /* Keep the pool error handled. */ }
  });
  return pool;
}

