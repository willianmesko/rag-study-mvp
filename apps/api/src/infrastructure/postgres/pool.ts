import { Pool } from "pg";

export function createPostgresPool(databaseUrl: string, max = 10): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });
}

