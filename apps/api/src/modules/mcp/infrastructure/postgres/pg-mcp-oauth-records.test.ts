import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { PgMcpOAuthRepository } from "./pg-mcp-oauth-repository.js";
import { StoredRecordError } from "../../../../platform/database/stored-record.js";

const id = "lumora_client_" + "a".repeat(43);
const saved = () => ({ id, name: "🧭".repeat(80), redirectUris: ["https://example.com/callback", "http://127.0.0.1:12345/callback"],
  expiresAt: new Date("2026-12-01T00:00:00Z") });
function fixture(rows: unknown[]) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  let releases = 0;
  const query = async (sql: string, values: unknown[] = []) => {
    queries.push({ sql, values });
    return { rows: sql.includes("count(*)") ? [{ count: "0" }] : /(?:SELECT|INSERT INTO).*mcp_oauth_clients/s.test(sql) ? rows : [],
      rowCount: sql.includes("pg_catalog.pg_settings") ? 3 : rows.length };
  };
  const pool = { query, connect: async () => ({ query, release: () => { releases++; } }) } as unknown as Pool;
  return { repository: new PgMcpOAuthRepository(pool), queries, releases: () => releases };
}

test("OAuth client reads preserve canonical callback order, SQL Unicode labels and Date expiry", async () => {
  const row = saved(), { repository, queries } = fixture([row]);
  assert.deepEqual(await repository.client(id), row);
  assert.deepEqual(queries[0]?.values, [id]); assert.match(queries[0]!.sql, /expires_at>clock_timestamp\(\)/);
  assert.equal(await fixture([]).repository.client(id), null);
});

test("OAuth registration decodes its returned record before commit and releases once", async () => {
  const row = saved(), { repository, queries, releases } = fixture([row]);
  assert.deepEqual(await repository.register({ id, name: row.name, redirectUris: row.redirectUris }), row);
  assert.equal(queries.at(-1)?.sql, "COMMIT"); assert.equal(releases(), 1);
  const insert = queries.find(({ sql }) => sql.startsWith("INSERT INTO"));
  assert.deepEqual(insert?.values, [id, row.name, JSON.stringify(row.redirectUris)]);
});

test("stored OAuth redirects reject malformed arrays and reuse the exact existing callback policy", async () => {
  for (const redirectUris of [null, {}, "PRIVATE_REDIRECT", [], Array(6).fill("https://example.com/callback"),
    [42], [{ value: "PRIVATE_REDIRECT" }], ["https://example.com/callback", "https://example.com/callback"],
    ["javascript:alert(1)"], ["https://example.com/callback#fragment"], ["http://example.com/callback"],
    ["https://user:PRIVATE_SECRET@example.com/callback"], ["https://example.com/callback?code=PRIVATE_CODE"]]) {
    for (const registering of [false, true]) {
      const { repository, queries, releases } = fixture([{ ...saved(), redirectUris }]);
      await assert.rejects(registering ? repository.register({ id, name: "Fixture", redirectUris: saved().redirectUris }) : repository.client(id),
        (error: unknown) => error instanceof StoredRecordError && error.code === "invalid_stored_record" &&
          !String(error).includes("PRIVATE_") && !JSON.stringify(error).includes("PRIVATE_") && !("cause" in error));
      if (registering) { assert.equal(queries.at(-1)?.sql, "ROLLBACK"); assert.equal(releases(), 1); }
      assert.ok(!queries.some(({ sql }) => sql === "COMMIT"));
    }
  }
});

test("invalid OAuth client driver fields fail safely and unselected private fields are never returned", async () => {
  for (const patch of [{ id: null }, { name: null }, { expiresAt: "PRIVATE_DATE" }, { expiresAt: new Date("invalid") }])
    await assert.rejects(fixture([{ ...saved(), ...patch }]).repository.client(id), StoredRecordError);
  const row = saved();
  assert.deepEqual(await fixture([{ ...row, access_token: "PRIVATE_TOKEN", unrelated: 123 }]).repository.client(id), row);
});
