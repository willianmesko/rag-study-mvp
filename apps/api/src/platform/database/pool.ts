import { Pool } from "pg";
import { metrics } from "@opentelemetry/api";
import { initializePostgresDeadlines, setPostgresWorkload, type PostgresWorkload } from "./sql-boundary.js";

export function createPostgresPool(databaseUrl: string, max = 10, workload: PostgresWorkload = "runtime"): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    onConnect: (client) => initializePostgresDeadlines(client, workload),
  });
  setPostgresWorkload(pool, workload);
  const faults = metrics.getMeter("lumora.database", "1.0").createCounter("lumora.database.pool.errors");
  const recordFault = (reason: "idle_connection_error" | "checked_out_connection_error") => {
    try { faults.add(1, { reason }); } catch { /* Diagnostics must not terminate the process. */ }
    try { console.warn(JSON.stringify({ event: "database_pool_fault", reason })); } catch { /* Keep client faults handled. */ }
  };
  const checkedOutFault = () => recordFault("checked_out_connection_error");
  // Existing repositories also check out clients directly. A fatal idle timeout
  // between their statements must remain handled until they release the client.
  pool.on("acquire", (client) => client.on("error", checkedOutFault));
  pool.on("release", (_error, client) => client.removeListener("error", checkedOutFault));
  pool.on("error", () => {
    // pg removes the failed idle client itself. Handle the event so a temporary
    // connection fault cannot become an unhandled EventEmitter exception.
    recordFault("idle_connection_error");
  });
  return pool;
}
