import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { docker, startLab, assertImage } from "./docker-lab.mjs";
import { seedCorpus, sha256, samples, uuid } from "./fixtures.mjs";
import { capacityProfile, corpusVersion } from "./profiles.mjs";
import { captureFailureState } from "./diagnostics.mjs";
import { eventLoopResolutionMs } from "./event-loop-probe.mjs";
import { validateGuardedCheckoutReceipt } from "./checkout-probe.mjs";
import { captureWorkflowQueues, verifyWorkflowQueueFixture } from "./workflow-queues.mjs";
import { headersFor, jsonResponse, referenceRecall, trafficPhase, uploadBurst, verifyIngestedSources } from "./traffic.mjs";

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const { Pool } = require("pg");
const root = fileURLToPath(new URL("../../", import.meta.url));
let stage = "arguments", interrupted = false;
const report = { kind: "lumora.capacity-lab", version: 3, profile: "pilot", passed: false, startedAt: new Date().toISOString() };
const commonLimitations = ["Deterministic 1024-d vectors do not measure semantic quality or multilingual accuracy.",
  "Synthetic auth, embeddings, chat, tokens and timings; no actual provider billing.", "One API process; no multi-replica burst-limit proof.",
  "Markdown only; no large OCR/PDF/DOCX or crash/restart load.",
  "Guarded checkout includes queue/connection/setup; direct pool queries and pure pool queue wait are not measured.",
  "Native event-loop and in-memory checkout collection add measurement overhead; bucket data is not exact percentiles.",
  "No Render capacity, field performance or production sizing conclusion."];

async function main() {
  const { values } = parseArgs({ options: { image: { type: "string", default: "lumora-api:capacity-ci" },
    profile: { type: "string", default: "pilot" }, "report-id": { type: "string", default: "pilot" } }, strict: true, allowPositionals: false });
  const profile = capacityProfile(values.profile), counts = profile.counts;
  const limitations = [...commonLimitations, ...(profile.name !== "sustained" ? ["Short pilot, not the sustained 30-minute baseline."] : []),
    ...(profile.durable ? [] : ["Legacy in-process ingestion; durable workflow load is not enabled."])];
  assertImage(values.image); assert.match(values["report-id"], /^[a-zA-Z0-9_-]{1,80}$/);
  const output = resolve(root, "reports/capacity", values["report-id"] + ".json");
  Object.assign(report, { profile: profile.name, configuration: profile,
    corpus: { workspaces: counts.length, chunks: counts.reduce((a, b) => a + b), distribution: counts,
    actorsPerWorkspace: 20, dimensions: 1024, seed: corpusVersion }, lockfileSha256: sha256(await readFile(resolve(root, "package-lock.json"))),
    source: /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? "") ? process.env.GITHUB_SHA : null,
    limitations, observationLimit: 1000, queueMetricsVersion: 1, poolWaitMs: null,
    eventLoop: { source: "api-process-native", resolutionMs: eventLoopResolutionMs, phases: [] }, actualProviderCostUsd: null });
  report.guardedCheckout = { source: "api-process-otel", phases: [] };
  let lab, pool, monitoring, poolFault = false;
  const cancelled = new AbortController();
  let stopMonitoring = false;
  const observations = [];
  const stop = () => { interrupted = true; cancelled.abort(); void lab?.cleanup(); };
  const deadline = setTimeout(stop, profile.deadlineMs); deadline.unref();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    stage = "start_lab"; lab = await startLab(root, values.image, profile);
    assert.equal(new URL(lab.databaseUrl).pathname, "/capacity_fixture");
    pool = new Pool({ connectionString: lab.databaseUrl, max: 2, connectionTimeoutMillis: 1000, statement_timeout: 5000, application_name: "lumora-capacity-observer" });
    pool.on("error", () => { poolFault = true; });
    stage = "postgres_readiness";
    let ready = false;
    for (let attempt = 0; attempt < 40 && !interrupted; attempt++) {
      try { await pool.query("SELECT 1"); ready = true; break; } catch { await delay(500); }
    }
    assert.ok(ready && !interrupted);
    stage = "migrate"; await lab.migrate(await readFile(resolve(root, "tests/fixtures/supabase-auth.sql"), "utf8"));
    stage = "seed"; const seedStarted = performance.now(), corpus = await seedCorpus(pool, counts, cancelled.signal);
    report.seedDurationMs = Math.round(performance.now() - seedStarted);
    stage = "queue_metric_fixture";
    report.workflowQueueFixture = await verifyWorkflowQueueFixture(pool, corpus.workspaces[0]);
    stage = "api_readiness"; const api = await lab.startApi();
    ready = false;
    for (let attempt = 0; attempt < 40 && !interrupted; attempt++) {
      try { const result = await jsonResponse(api.origin + "/health"); if (result.status === 200) { ready = true; break; } } catch { /* bounded startup polling */ }
      await delay(500);
    }
    assert.ok(ready && !interrupted, "Synthetic API did not become ready.");
    const resetProbe = async () => {
      const response = await jsonResponse(api.probeOrigin + "/reset", { method: "POST", signal: cancelled.signal });
      assert.equal(response.status, 200); assert.deepEqual(response.body, { reset: true });
    };
    const captureProbe = async (name) => {
      const { status, body } = await jsonResponse(api.probeOrigin + "/metrics", { signal: cancelled.signal });
      assert.equal(status, 200); assert.deepEqual(Object.keys(body).sort(), ["delayMs", "guardedCheckout", "samples", "utilization"]);
      assert.ok(Number.isSafeInteger(body.samples) && body.samples > 0);
      assert.deepEqual(Object.keys(body.delayMs).sort(), ["max", "mean", "min", "p50", "p95", "p99", "stddev"]);
      assert.ok(Object.values(body.delayMs).every((value) => Number.isFinite(value) && value >= 0));
      assert.ok(Number.isFinite(body.utilization) && body.utilization >= 0 && body.utilization <= 1);
      const checkout = validateGuardedCheckoutReceipt(body.guardedCheckout);
      assert.ok(checkout.outcomes.find(({ outcome }) => outcome === "acquired").count > 0);
      const { guardedCheckout: _checkout, ...eventLoop } = body;
      report.eventLoop.phases.push({ name, ...eventLoop }); report.guardedCheckout.phases.push({ name, ...checkout });
    };
    stage = "membership";
    const denied = await jsonResponse(api.origin + "/v1/search?q=synthetic", {
      headers: headersFor(corpus.workspaces[1], corpus.workspaces[0].actors[0])
    });
    assert.equal(denied.status, 403, "Cross-workspace membership was not denied.");
    const viewer = new FormData(); viewer.set("file", new Blob(["Synthetic viewer upload"], { type: "text/markdown" }), "viewer.md");
    const blocked = await jsonResponse(api.origin + "/v1/admin/uploads", { method: "POST", headers: headersFor(corpus.workspaces[0], corpus.workspaces[0].actors[1]), body: viewer });
    assert.equal(blocked.status, 403, "Viewer upload was not denied.");
    stage = "reference_recall"; report.referenceRecall = await referenceRecall(api.origin, pool, corpus);
    const clearOwnedCache = async () => {
      if (profile.cold) await pool.query("DELETE FROM semantic_model_answer_cache WHERE tenant_id=ANY($1::uuid[])",
        [corpus.workspaces.map(({ tenantId }) => tenantId)]);
    };
    await clearOwnedCache();
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
          const workflowQueues = await captureWorkflowQueues(pool, corpus.workspaces.map(({ tenantId }) => tenantId));
          const stats = (await docker(["stats", "--no-stream", "--format", "{{json .}}", api.container, lab.postgres, lab.provider]))
            .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)).map(({ Name, CPUPerc, MemUsage, PIDs }) => ({
              role: Name === api.container ? "api" : Name === lab.postgres ? "postgres" : Name === lab.provider ? "provider" : "unknown",
              cpuPercent: CPUPerc, memoryUsage: MemUsage, processes: PIDs }));
          if (observations.length < 1000) observations.push({ elapsedMs: Date.now() - Date.parse(report.startedAt), ...state.rows[0], workflowQueues, containers: stats });
        } catch { if (observations.length < 1000) observations.push({ observationFailed: true }); }
        await delay(1000);
      }
    })();
    stage = "baseline"; await resetProbe();
    const baseline = await trafficPhase(api.origin, corpus, { name: "api_only", seconds: profile.controlSeconds, clients: profile.clients, signal: cancelled.signal });
    report.phases = [baseline];
    assert.equal(baseline.failed, 0, "Control traffic failed.");
    stage = "baseline_metrics"; await captureProbe("api_only");
    await clearOwnedCache();
    stage = "mixed";
    await resetProbe();
    const [mixed, jobs] = await Promise.all([
      trafficPhase(api.origin, corpus, { name: "with_ingestion", seconds: profile.mixedSeconds, clients: profile.clients, signal: cancelled.signal }),
      uploadBurst(api.origin, corpus.workspaces[0], 6, cancelled.signal)
    ]);
    report.phases = [baseline, mixed];
    assert.equal(mixed.failed, 0, "Mixed traffic failed.");
    stage = "mixed_metrics"; await captureProbe("with_ingestion");
    stage = "ingestion_drain";
    let rows = [];
    for (let attempt = 0; attempt < 45 && !interrupted; attempt++) {
      rows = (await pool.query("SELECT id,status,chunk_count FROM ingestion_jobs WHERE id=ANY($1::uuid[]) ORDER BY id", [jobs])).rows;
      if (rows.length === jobs.length && rows.every(({ status }) => ["completed", "failed", "cancelled"].includes(status))) break;
      await delay(1000);
    }
    assert.equal(rows.length, 6); assert.ok(rows.every(({ status, chunk_count }) => status === "completed" && chunk_count > 0), "An ingestion job was lost or unsuccessful.");
    stage = "ingestion_measurements";
    const duplicateCount = await pool.query("SELECT count(*)::int AS count FROM ingestion_jobs WHERE tenant_id=$1 AND source LIKE 'capacity/upload-%'", [corpus.workspaces[0].tenantId]);
    assert.equal(duplicateCount.rows[0].count, 6);
    // Legacy work emits processing/started; the durable graph's first work is
    // source_read/started. Require all six observed starts on the selected path.
    const queueWaitStartStage = profile.durable ? "source_read" : "processing";
    const queueWait = await pool.query(`SELECT extract(epoch FROM(min(e.created_at)-j.created_at))*1000 AS wait_ms
      FROM ingestion_jobs j JOIN ingestion_job_events e ON e.job_id=j.id AND e.stage=$2 AND e.status='started'
      WHERE j.id=ANY($1::uuid[]) GROUP BY j.id,j.created_at`, [jobs, queueWaitStartStage]);
    assert.equal(queueWait.rowCount, 6);
    report.ingestion = { accepted: 6, replayed: 6, uniqueJobs: rows.length, completed: rows.length, queueWaitStartStage,
      queueWaitMs: samples(queueWait.rows.map(({ wait_ms }) => Number(wait_ms))) };
    stage = "new_source_verification";
    report.postIngestionVerification = await verifyIngestedSources(api.origin, corpus, 6, cancelled.signal);
    stage = "durable_receipt";
    const ownedTenants = corpus.workspaces.map(({ tenantId }) => tenantId);
    const workflowRows = async () => (await pool.query(`SELECT kind,status,count(*)::int AS count FROM workflow_runs
      WHERE tenant_id=ANY($1::uuid[]) GROUP BY kind,status ORDER BY kind,status`, [ownedTenants])).rows;
    let runs = await workflowRows();
    for (let attempt = 0; attempt < 20 && runs.some(({ status }) => ["queued", "running"].includes(status)); attempt++) {
      cancelled.signal.throwIfAborted(); await delay(500); runs = await workflowRows();
    }
    const checkpointCount = (await pool.query("SELECT count(*)::int AS count FROM workflow_checkpoints WHERE tenant_id=ANY($1::uuid[])", [ownedTenants])).rows[0].count;
    report.durableWorkflows = { enabled: profile.durable, runs, checkpoints: checkpointCount };
    if (profile.durable) {
      assert.ok(runs.every(({ status }) => status === "completed"), "A durable synthetic workflow did not complete.");
      assert.ok(runs.some(({ kind, count }) => kind === "chat" && count > 0), "Durable chat was not exercised.");
      assert.ok(runs.some(({ kind, count }) => kind === "ingestion" && count === 6), "Durable ingestion was not exercised.");
      assert.ok(checkpointCount > 0, "Durable execution produced no checkpoints.");
    } else { assert.equal(runs.length, 0); assert.equal(checkpointCount, 0); }
    report.provider = (await jsonResponse(lab.providerOrigin + "/fixture/stats")).body;
    report.resources = await lab.receipt();
    assert.ok(report.resources.images.every(({ oomKilled, running, publishedPorts }) => !oomKilled && running && publishedPorts === 0), "A fixture process stopped, exhausted memory or published a host port.");
    assert.equal(poolFault, false); assert.equal(interrupted, false);
    assert.ok(report.phases.every(({ attempted, failed, completedMs }) => attempted >= 3 && failed === 0 && completedMs.count >= 3));
    assert.ok(observations.some(({ workflowQueues }) => workflowQueues?.length === 3), "No durable queue observation was captured.");
    report.guards = { crossWorkspaceReadDenied: true, viewerUploadDenied: true, sourceScopeCheckedOnEveryResult: true,
      chunkDocumentAssociationChecked: true, unknownSourcesResolvedInFixtureDatabase: true, ownershipLookups: corpus.ownershipLookups,
      uploadDeduplicated: true, durableQueueFixtureAndObservationChecked: true, lostJobs: 0, externalNetwork: false };
    report.passed = true;
  } catch (error) {
    cancelled.abort();
    report.failure = { stage, reason: interrupted ? "interrupted_or_deadline" : "capacity_pilot_failed",
      ...(["ERROR", "FATAL", "PANIC"].includes(error?.severity) && /^[A-Z0-9]{5}$/.test(error?.code ?? "")
        ? { sqlState: error.code } : {}),
      ...(stage === "start_lab" && typeof error?.setupStage === "string" && /^[a-z_]{1,40}$/.test(error.setupStage) ? { setupStage: error.setupStage } : {}) };
    if (stage === "start_lab" && error?.cleanup) report.setupCleanup = error.cleanup;
    if (pool) report.failureState = await captureFailureState(pool, counts.map((_, index) => uuid(2, index + 1)))
      .catch(() => ({ unavailable: true }));
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
