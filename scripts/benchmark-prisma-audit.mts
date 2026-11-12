import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPostgresPool } from "../apps/api/src/platform/database/pool.js";
import type { AuditEventRepository } from "../apps/api/src/modules/usage/application/ports/audit-event-repository.js";
import { PgAuditEventRepository } from "../apps/api/src/modules/usage/infrastructure/postgres/pg-audit-event-repository.js";
import { PrismaAuditEventRepository } from "../apps/api/src/modules/usage/infrastructure/prisma/prisma-audit-event-repository.js";

const address = new URL(process.env.PRISMA_PILOT_DATABASE_URL ?? "http://missing");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(address.hostname) && /^\/prisma_pilot_[a-z_]+$/.test(address.pathname),
  "Benchmark accepts only a disposable loopback prisma_pilot_* database.");
const pool = createPostgresPool(address.href, 2);
const primaryPool = createPostgresPool(address.href, 10);
const client = new PrismaClient({ adapter: new PrismaPg(pool), log: [{ emit: "event", level: "query" }] });
let queries = 0;
client.$on("query", () => { queries++; }); // Never record SQL, parameters or credentials.
const adapters: Record<string, AuditEventRepository> = { sql: new PgAuditEventRepository(pool), prisma: new PrismaAuditEventRepository(client) };
const tenantId = randomUUID();
const input: Parameters<AuditEventRepository["record"]>[0] = { tenantId, actorUserId: null,
  action: "conversation.feedback", resourceType: "conversation", resourceId: null, requestId: "synthetic-benchmark",
  metadata: { feedback: 1, synthetic: true } };
const stats = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return { samples: sorted.length, medianMs: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1) };
};
try {
  await pool.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Synthetic audit benchmark',$2)", [tenantId, `audit-bench-${tenantId}`]);
  for (let i = 0; i < 12; i++) for (const adapter of Object.values(adapters)) await adapter.record(input);
  const cases: Record<string, unknown>[] = [];
  for (const concurrency of [1, 4]) {
    const timings: Record<string, number[]> = { sql: [], prisma: [] };
    const queryStart = queries;
    let peakConnections = pool.totalCount;
    // Alternate the adapter order each round to reduce warm-up/order bias.
    for (let round = 0; round < 30; round++) {
      for (const name of round % 2 ? ["sql", "prisma"] : ["prisma", "sql"]) {
        await Promise.all(Array.from({ length: concurrency }, async () => {
          const start = performance.now();
          await adapters[name]!.record(input);
          timings[name]!.push(performance.now() - start);
          peakConnections = Math.max(peakConnections, pool.totalCount);
        }));
      }
    }
    const prismaQueries = queries - queryStart;
    assert.equal(prismaQueries, timings.prisma!.length, "A Prisma audit append must issue exactly one SQL statement.");
    assert.ok(peakConnections <= 2, "Both adapters must share the existing two-connection pool.");
    cases.push({ concurrency, sql: { ...stats(timings.sql!), statementsPerAppend: 1 },
      prisma: { ...stats(timings.prisma!), statementsPerAppend: prismaQueries / timings.prisma!.length }, peakConnections });
  }
  // Separate the equal-pool ORM comparison above from the actual production topology.
  // Before: audit on primary(10), policy on Prisma(2). After: both on Prisma(2).
  await client.workspaceChatModelPolicy.create({ data: { tenantId, policy: { allowedModelIds: ["default"], defaultModelId: "default", auto: null } } });
  for (let i = 0; i < 12; i++) {
    await new PgAuditEventRepository(primaryPool).record(input);
    await adapters.prisma!.record(input);
    await client.workspaceChatModelPolicy.findUnique({ where: { tenantId } });
  }
  const mixed = [];
  for (const topology of ["legacy-primary", "shared-prisma"]) {
    const adapter = topology === "legacy-primary" ? new PgAuditEventRepository(primaryPool) : adapters.prisma!;
    const auditMs: number[] = [], policyMs: number[] = [];
    for (let round = 0; round < 30; round++) {
      const writes = Array.from({ length: 4 }, async () => {
        const start = performance.now(); await adapter.record(input); auditMs.push(performance.now() - start);
      });
      const start = performance.now();
      await Promise.all([...writes, client.workspaceChatModelPolicy.findUnique({ where: { tenantId } }).then(value => {
        assert.ok(value); policyMs.push(performance.now() - start);
      })]);
    }
    mixed.push({ topology, concurrentAuditWrites: 4, policyReadsPerRound: 1, audit: stats(auditMs), policy: stats(policyMs) });
  }
  const server = await pool.query("SELECT version() AS version");
  const count = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE tenant_id=$1", [tenantId]);
  assert.equal(count.rows[0].n, 588, "Warm-up and measured appends must all persist exactly once.");
  console.log(JSON.stringify({ kind: "lumora.prisma-audit-benchmark", measuredAt: new Date().toISOString(),
    node: process.version, clientArchitecture: process.arch, server: server.rows[0].version,
    scope: "Disposable local PostgreSQL; synthetic metadata; no provider or hosted-capacity claim", warmupPerAdapter: 12, warmupPerTopology: 12,
    storedRows: count.rows[0].n, extraRuntimePools: 0, equalPoolCases: cases, productionTopologyCases: mixed }, null, 2));
} finally {
  try { await pool.query("DELETE FROM tenants WHERE id=$1", [tenantId]); }
  finally { await client.$disconnect(); await pool.end(); await primaryPool.end(); }
}
