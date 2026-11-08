import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { docker, startLab, assertImage } from "./docker-lab.mjs";
import { seedCorpus, sha256, samples, workspaceCounts } from "./fixtures.mjs";
import { headersFor, jsonResponse, referenceRecall, trafficPhase, uploadBurst } from "./traffic.mjs";

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const { Pool } = require("pg");
const root = fileURLToPath(new URL("../../", import.meta.url));
let stage = "arguments", interrupted = false;
const report = { kind: "lumora.capacity-lab", version: 1, profile: "pilot", passed: false, startedAt: new Date().toISOString() };
const limitations = ["Short pilot, not the sustained 30-minute baseline.", "Deterministic 1024-d vectors do not measure semantic quality.",
  "Synthetic auth, embeddings, chat, tokens and timings; no actual provider billing.", "One API process; no multi-replica burst-limit proof.",
  "Legacy in-process ingestion, Markdown only; no durable workflow, OCR/PDF/DOCX or crash/restart load.",
  "Pool checkout wait and event-loop delay are not measured.", "No Render capacity, field performance or production sizing conclusion."];

async function main() {
  const { values } = parseArgs({ options: { image: { type: "string", default: "lumora-api:capacity-ci" }, "report-id": { type: "string", default: "pilot" } }, strict: true, allowPositionals: false });
  assertImage(values.image); assert.match(values["report-id"], /^[a-zA-Z0-9_-]{1,80}$/);
  const output = resolve(root, "reports/capacity", values["report-id"] + ".json");
  Object.assign(report, { corpus: { workspaces: workspaceCounts.length, chunks: workspaceCounts.reduce((a, b) => a + b), distribution: workspaceCounts,
    actorsPerWorkspace: 20, dimensions: 1024, seed: "capacity-fixture-v1" }, lockfileSha256: sha256(await readFile(resolve(root, "package-lock.json"))),
    source: /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? "") ? process.env.GITHUB_SHA : null,
    limitations, poolWaitMs: null, eventLoopDelayMs: null, actualProviderCostUsd: null });
  let lab, pool, monitoring, poolFault = false;
  const cancelled = new AbortController();
  let stopMonitoring = false;
  const observations = [];
  const stop = () => { interrupted = true; cancelled.abort(); void lab?.cleanup(); };
  const deadline = setTimeout(stop, 240_000); deadline.unref();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    stage = "start_lab"; lab = await startLab(root, values.image);
    assert.equal(new URL(lab.databaseUrl).hostname, "127.0.0.1");
    pool = new Pool({ connectionString: lab.databaseUrl, max: 2, connectionTimeoutMillis: 1000, statement_timeout: 5000, application_name: "lumora-capacity-observer" });
    pool.on("error", () => { poolFault = true; });
    stage = "postgres_readiness";
    let ready = false;
    for (let attempt = 0; attempt < 40 && !interrupted; attempt++) {
      try { await pool.query("SELECT 1"); ready = true; break; } catch { await delay(500); }
    }
    assert.ok(ready && !interrupted);
    stage = "migrate"; await lab.migrate(await readFile(resolve(root, "tests/fixtures/supabase-auth.sql"), "utf8"));
    stage = "seed"; const corpus = await seedCorpus(pool);
    stage = "api_readiness"; const api = await lab.startApi();
    ready = false;
    for (let attempt = 0; attempt < 40 && !interrupted; attempt++) {
      try { const result = await jsonResponse(api.origin + "/health"); if (result.status === 200) { ready = true; break; } } catch { /* bounded startup polling */ }
      await delay(500);
    }
    assert.ok(ready && !interrupted, "Synthetic API did not become ready.");
    stage = "membership";
    const denied = await jsonResponse(api.origin + "/v1/search?q=synthetic", {
      headers: headersFor(corpus.workspaces[1], corpus.workspaces[0].actors[0])
    });
    assert.equal(denied.status, 403, "Cross-workspace membership was not denied.");
    const viewer = new FormData(); viewer.set("file", new Blob(["Synthetic viewer upload"], { type: "text/markdown" }), "viewer.md");
    const blocked = await jsonResponse(api.origin + "/v1/admin/uploads", { method: "POST", headers: headersFor(corpus.workspaces[0], corpus.workspaces[0].actors[1]), body: viewer });
    assert.equal(blocked.status, 403, "Viewer upload was not denied.");
    stage = "reference_recall"; report.referenceRecall = await referenceRecall(api.origin, pool, corpus);
    const versions = await pool.query("SELECT current_setting('server_version') AS postgres, (SELECT extversion FROM pg_extension WHERE extname='vector') AS vector");
    report.database = versions.rows[0];
    monitoring = (async () => {
      while (!stopMonitoring) {
        try {
          const state = await pool.query(`SELECT
            (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock') AS lock_waiters,
            (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND pid<>pg_backend_pid()) AS active_connections,
            (SELECT count(*)::int FROM ingestion_jobs WHERE status='queued') AS queued,
            (SELECT coalesce(max(extract(epoch FROM(now()-created_at))*1000),0)::float8 FROM ingestion_jobs WHERE status='queued') AS oldest_queue_ms`);
          const stats = (await docker(["stats", "--no-stream", "--format", "{{json .}}", api.container, lab.postgres, lab.provider]))
            .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)).map(({ Name, CPUPerc, MemUsage, PIDs }) => ({
              role: Name === api.container ? "api" : Name === lab.postgres ? "postgres" : Name === lab.provider ? "provider" : "unknown",
              cpuPercent: CPUPerc, memoryUsage: MemUsage, processes: PIDs }));
          observations.push({ elapsedMs: Date.now() - Date.parse(report.startedAt), ...state.rows[0], containers: stats });
        } catch { observations.push({ observationFailed: true }); }
        await delay(1000);
      }
    })();
    stage = "baseline"; const baseline = await trafficPhase(api.origin, corpus, { name: "api_only", seconds: 12, signal: cancelled.signal });
    stage = "mixed";
    const [mixed, jobs] = await Promise.all([
      trafficPhase(api.origin, corpus, { name: "with_ingestion", seconds: 24, signal: cancelled.signal }),
      uploadBurst(api.origin, corpus.workspaces[0], 6, cancelled.signal)
    ]);
    report.phases = [baseline, mixed];
    stage = "ingestion_drain";
    let rows = [];
    for (let attempt = 0; attempt < 45 && !interrupted; attempt++) {
      rows = (await pool.query("SELECT id,status,chunk_count FROM ingestion_jobs WHERE id=ANY($1::uuid[]) ORDER BY id", [jobs])).rows;
      if (rows.length === jobs.length && rows.every(({ status }) => ["completed", "failed", "cancelled"].includes(status))) break;
      await delay(1000);
    }
    assert.equal(rows.length, 6); assert.ok(rows.every(({ status, chunk_count }) => status === "completed" && chunk_count > 0), "An ingestion job was lost or unsuccessful.");
    const duplicateCount = await pool.query("SELECT count(*)::int AS count FROM ingestion_jobs WHERE tenant_id=$1 AND source LIKE 'capacity/upload-%'", [corpus.workspaces[0].tenantId]);
    assert.equal(duplicateCount.rows[0].count, 6);
    const queueWait = await pool.query(`SELECT extract(epoch FROM(min(e.created_at)-j.created_at))*1000 AS wait_ms
      FROM ingestion_jobs j JOIN ingestion_job_events e ON e.job_id=j.id AND e.stage='processing' AND e.status='started'
      WHERE j.id=ANY($1::uuid[]) GROUP BY j.id,j.created_at`, [jobs]);
    assert.equal(queueWait.rowCount, 6);
    report.ingestion = { accepted: 6, replayed: 6, uniqueJobs: rows.length, completed: rows.length, queueWaitMs: samples(queueWait.rows.map(({ wait_ms }) => Number(wait_ms))) };
    report.provider = (await jsonResponse(lab.providerOrigin + "/fixture/stats")).body;
    report.resources = await lab.receipt();
    assert.ok(report.resources.images.every(({ oomKilled, running }) => !oomKilled && running), "A fixture process stopped or exhausted memory.");
    assert.equal(poolFault, false); assert.equal(interrupted, false);
    assert.ok(report.phases.every(({ attempted, failed, completedMs }) => attempted >= 3 && failed === 0 && completedMs.count >= 3));
    report.guards = { crossWorkspaceReadDenied: true, viewerUploadDenied: true, sourceScopeCheckedOnEveryResult: true,
      uploadDeduplicated: true, lostJobs: 0, externalNetwork: false };
    report.passed = true;
  } catch {
    cancelled.abort();
    report.failure = { stage, reason: interrupted ? "interrupted_or_deadline" : "capacity_pilot_failed" };
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline); process.off("SIGINT", stop); process.off("SIGTERM", stop);
    stopMonitoring = true; await monitoring?.catch(() => undefined);
    report.observations = observations; await pool?.end().catch(() => undefined);
    stage = "cleanup"; report.cleanup = await lab?.cleanup();
    if (report.cleanup && (report.cleanup.failed > 0 || report.cleanup.stopped.some(({ exitCode, oomKilled }) => exitCode !== 0 || oomKilled))) {
      report.passed = false; report.failure ??= { stage, reason: "capacity_cleanup_failed" }; process.exitCode = 1;
    }
    report.finishedAt = new Date().toISOString();
    await mkdir(resolve(root, "reports/capacity"), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ kind: report.kind, profile: report.profile, passed: report.passed, output: "reports/capacity/" + values["report-id"] + ".json", failure: report.failure }));
  }
}
main().catch(() => { console.error(JSON.stringify({ kind: report.kind, passed: false, stage, reason: "capacity_setup_failed" })); process.exitCode = 1; });
