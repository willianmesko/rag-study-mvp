import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { actorFromToken, dimensions, key, samples, statement, tokenFor, uuid, vectorFor } from "../../scripts/capacity/fixtures.mjs";
import { assertImage, containerOrigin } from "../../scripts/capacity/docker-lab.mjs";
import { assertSources, decodeFrame, safePlan, verifySources } from "../../scripts/capacity/traffic.mjs";
import { createFixtureServer } from "../../scripts/capacity/provider.mjs";
import { capacityProfile, chunkIdentityNumber, corpusVersion } from "../../scripts/capacity/profiles.mjs";
import { safeFailureRows } from "../../scripts/capacity/diagnostics.mjs";
import { createEventLoopProbe, nativeDelaySnapshot } from "../../scripts/capacity/event-loop-probe.mjs";

test("native delay snapshots distinguish no samples from real zero and emit only allowed measurements", () => {
  const empty = nativeDelaySnapshot({ count: 0, min: Number.MAX_SAFE_INTEGER, max: 0, mean: NaN, stddev: NaN,
    percentile() { throw new Error("No percentile exists without samples."); } }, NaN);
  assert.equal(empty.samples, 0); assert.equal(empty.utilization, null);
  assert.ok(Object.values(empty.delayMs).every((value) => value === null));
  const measured = nativeDelaySnapshot({ count: 4, min: 10_000_000, max: 40_000_000, mean: 20_000_000,
    stddev: 0, percentile: (percentile) => percentile * 1_000_000, private: "PRIVATE_SENTINEL" }, 0);
  assert.equal(measured.delayMs.min, 10); assert.equal(measured.delayMs.p95, 95);
  assert.equal(measured.delayMs.mean, 20); assert.equal(measured.delayMs.stddev, 0); assert.equal(measured.utilization, 0);
  assert.ok(!JSON.stringify(measured).includes("PRIVATE_SENTINEL"));
});
test("the native probe exposes only bounded metrics/reset and closes its sampler with its server", async (t) => {
  const server = createEventLoopProbe(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = "http://127.0.0.1:" + server.address().port;
  const response = await fetch(base + "/metrics"), text = await response.text(), metrics = JSON.parse(text);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(Buffer.byteLength(text) < 2048);
  assert.deepEqual(Object.keys(metrics).sort(), ["delayMs", "samples", "utilization"]);
  assert.ok(Number.isSafeInteger(metrics.samples) && metrics.samples >= 0);
  const reset = await fetch(base + "/reset", { method: "POST" });
  assert.equal(reset.status, 200); assert.deepEqual(await reset.json(), { reset: true });
  const denied = await fetch(base + "/metrics?token=PRIVATE_SENTINEL");
  assert.equal(denied.status, 404); assert.deepEqual(await denied.json(), { error: "not_found" });
});

test("failed-load diagnostics retain fixed workflow stages and counts without raw stored errors", () => {
  assert.deepEqual(safeFailureRows([{ status: "failed", stage: "embedding", error_code: "budget_exceeded", count: 6 }]),
    [{ status: "failed", stage: "embedding", reason: "budget_exceeded", count: 6 }]);
  const safe = safeFailureRows([{ status: "PRIVATE_STATUS", stage: "PRIVATE_STAGE", error_code: "PRIVATE_ERROR", count: "PRIVATE_COUNT", message: "PRIVATE_MESSAGE" }]);
  assert.deepEqual(safe, [{ status: "other", stage: "other", reason: "other", count: null }]);
  assert.ok(!JSON.stringify(safe).includes("PRIVATE_"));
});

test("capacity profiles cap scale, duration and clients while keeping the sustained cohort explicit", () => {
  for (const name of ["pilot", "durable-pilot", "sustained"]) {
    const profile = capacityProfile(name);
    assert.ok(Object.isFrozen(profile) && Object.isFrozen(profile.counts));
    assert.ok(profile.clients >= 1 && profile.clients <= 10);
    assert.ok(profile.counts.length <= 10 && profile.counts.reduce((a, b) => a + b) <= 50000);
    assert.ok(profile.mixedSeconds <= 1800 && profile.deadlineMs <= 2700000);
    assert.ok(profile.deadlineMs > (profile.controlSeconds + profile.mixedSeconds) * 1000);
  }
  const large = capacityProfile("sustained");
  assert.equal(large.counts.length, 10); assert.equal(large.counts.reduce((a, b) => a + b), 50000);
  assert.equal(large.counts[0], 40000); assert.equal(large.clients, 10);
  assert.equal(large.mixedSeconds, 1800); assert.equal(large.cacheTtlSeconds, 60); assert.equal(large.durable, true);
  assert.equal(capacityProfile("durable-pilot").durable, true);
  for (const name of ["__proto__", "stress", "sustained --timeout=9999", ""]) assert.throws(() => capacityProfile(name));
  assert.equal(corpusVersion, "capacity-corpus-v2");
});
test("synthetic chunk identities remain unique across the skewed 50000-chunk corpus", () => {
  const ids = new Set();
  for (const [workspace, count] of capacityProfile("sustained").counts.entries()) {
    for (let ordinal = 0; ordinal < count; ordinal++) ids.add(chunkIdentityNumber(workspace, ordinal));
  }
  assert.equal(ids.size, 50000);
  for (const [workspace, ordinal] of [[-1, 0], [10, 0], [0, -1], [0, 40000]]) assert.throws(() => chunkIdentityNumber(workspace, ordinal));
});

test("fixture vectors are reproducible, normalized, 1024-dimensional and change with the query key", () => {
  const first = vectorFor("K00003 retained"), same = vectorFor("K00003 mantido"), other = vectorFor("K00031 retained");
  assert.equal(first.length, dimensions); assert.ok(first.every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(...first) - 1) < 1e-12); assert.deepEqual(first, same); assert.notDeepEqual(first, other);
  assert.ok(Math.abs(first.reduce((sum, value, index) => sum + value * other[index], 0)) < 0.2);
  assert.throws(() => key(100000)); assert.throws(() => uuid(0, 1));
});
test("empty measurements are unknown and nearest-rank percentiles do not mutate samples", () => {
  assert.deepEqual(samples([]), { count: 0, p50: null, p95: null, max: null });
  const values = [30, 10, 20]; assert.deepEqual(samples(values), { count: 3, p50: 20, p95: 30, max: 30 }); assert.deepEqual(values, [30, 10, 20]);
  assert.throws(() => samples([NaN])); assert.throws(() => samples([-1]));
});
test("the lab rejects arbitrary image names and fixture identities never accept production bearer tokens", () => {
  assert.equal(assertImage("lumora-api:capacity-ci"), "lumora-api:capacity-ci");
  for (const image of ["other/image:latest", "lumora-api:ci", "--privileged", "lumora-api:capacity-ci;other"]) assert.throws(() => assertImage(image));
  assert.equal(actorFromToken("Bearer " + tokenFor(uuid(1, 4))), uuid(1, 4));
  for (const token of [undefined, "Bearer real-token", "Bearer capacity-fixture_invalid", "Bearer " + tokenFor(uuid(1, 4)) + "tail"]) assert.equal(actorFromToken(token), null);
});
test("source guards reject an empty answer or a source owned by another workspace", () => {
  const workspace = { tenantId: uuid(2, 1) }, documents = new Map([[uuid(3, 1), uuid(2, 1)], [uuid(3, 2), uuid(2, 2)]]);
  assert.doesNotThrow(() => assertSources([{ documentId: uuid(3, 1) }], workspace, documents));
  assert.throws(() => assertSources([], workspace, documents));
  assert.throws(() => assertSources([{ documentId: uuid(3, 2) }], workspace, documents));
  assert.throws(() => assertSources([{ documentId: uuid(3, 99) }], workspace, documents));
  const chunks = new Map([[uuid(4, 1), { tenantId: uuid(2, 1), documentId: uuid(3, 1) }],
    [uuid(4, 2), { tenantId: uuid(2, 2), documentId: uuid(3, 2) }]]);
  assert.doesNotThrow(() => assertSources([{ documentId: uuid(3, 1), chunkId: uuid(4, 1) }], workspace, documents, chunks));
  assert.throws(() => assertSources([{ documentId: uuid(3, 1), chunkId: uuid(4, 2) }], workspace, documents, chunks));
  documents.set(uuid(3, 3), uuid(2, 1));
  assert.throws(() => assertSources([{ documentId: uuid(3, 3), chunkId: uuid(4, 1) }], workspace, documents, chunks));
});
test("new ingestion sources require scoped authoritative ownership instead of trusting response fields", async () => {
  const workspace = { tenantId: uuid(2, 1) }, source = { documentId: uuid(3, 9), chunkId: uuid(4, 9), tenantId: uuid(2, 1) };
  let lookups = 0;
  const corpus = { documents: new Map(), chunks: new Map(), async hydrateSourceOwners(tenantId, sources) {
    assert.equal(tenantId, workspace.tenantId); assert.deepEqual(sources, [source]); lookups++;
    corpus.documents.set(source.documentId, tenantId);
    corpus.chunks.set(source.chunkId, { tenantId, documentId: source.documentId });
  } };
  await verifySources([source], workspace, corpus); await verifySources([source], workspace, corpus);
  assert.equal(lookups, 1);
  await assert.rejects(verifySources([source], workspace, { documents: new Map(), chunks: new Map(), hydrateSourceOwners: async () => {} }));
  await assert.rejects(verifySources([source], workspace, { documents: new Map(), chunks: new Map() }));
});
test("Linux fixture endpoints come only from the owned private network and never publish host ports", () => {
  const info = (ip, bindings = {}) => ({ NetworkSettings: { Networks: { owned: { IPAddress: ip } } }, HostConfig: { PortBindings: bindings } });
  assert.equal(containerOrigin(info("172.18.0.2"), "owned", 5432), "http://172.18.0.2:5432");
  assert.equal(containerOrigin(info("172.18.0.2"), "owned", 3001), "http://172.18.0.2:3001");
  assert.throws(() => containerOrigin(info("172.18.0.2"), "owned", 4000));
  for (const ip of ["127.0.0.1", "8.8.8.8", "169.254.169.254", "::1", "malformed"]) assert.throws(() => containerOrigin(info(ip), "owned", 5432));
  assert.throws(() => containerOrigin(info("172.18.0.2"), "other", 5432));
  assert.throws(() => containerOrigin(info("172.18.0.2", { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "5432" }] }), "owned", 5432));
});
test("the lab consumes validated canonical SSE frames and rejects malformed or ambiguous data", () => {
  assert.equal(decodeFrame(": keep-alive"), null);
  assert.deepEqual(decodeFrame('id: 1\nevent: accepted\ndata: {"type":"accepted"}'), { type: "accepted" });
  assert.throws(() => decodeFrame('data: {"type":"made_up"}'));
  assert.throws(() => decodeFrame('data: {"type":"accepted"}\ndata: {"type":"completed"}'));
});
test("plan reports retain execution measurements without raw filters, vector literals or output expressions", () => {
  const plan = safePlan({ "Node Type": "Limit", "Actual Rows": 5, Output: ["PRIVATE_SENTINEL"], Plans: [
    { "Node Type": "Index Scan", "Index Name": "synthetic_index", Filter: "PRIVATE_SENTINEL", "Index Cond": "PRIVATE_SENTINEL", "Shared Hit Blocks": 4 }
  ] });
  assert.equal(plan["Actual Rows"], 5); assert.equal(plan.Plans[0]["Shared Hit Blocks"], 4);
  assert.equal(plan.Plans[0]["Index Name"], "synthetic_index"); assert.ok(!JSON.stringify(plan).includes("PRIVATE_SENTINEL"));
});
test("fixture HTTP endpoints reject unexpected models and return deterministic bounded embedding/chat shapes", async (t) => {
  const server = createFixtureServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = "http://127.0.0.1:" + server.address().port;
  assert.equal((await fetch(base + "/auth/v1/user")).status, 401);
  const actor = uuid(1, 4);
  const identity = await fetch(base + "/auth/v1/user", { headers: { authorization: "Bearer " + tokenFor(actor) } });
  assert.equal((await identity.json()).id, actor);
  const post = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post("/api/embed", { model: "unexpected", input: "K00003" })).status, 400);
  const embedding = await (await post("/api/embed", { model: "capacity-fixture-v1", input: "K00003" })).json();
  assert.deepEqual(embedding.embeddings, [vectorFor("K00003")]); assert.equal(embedding.prompt_eval_count, 32);
  const response = await (await post("/api/chat", { model: "capacity-fixture-v1", stream: true })).text();
  const frames = response.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(frames.at(-1).done, true); assert.equal(frames.at(-1).eval_count, 32);
  assert.deepEqual(JSON.parse(frames.map((frame) => frame.message.content).join("")), { answer: statement, citedChunkIds: ["S1"], refusalReason: null });
  const stats = await (await fetch(base + "/fixture/stats")).json();
  assert.equal(stats.auth, 2); assert.equal(stats.embedding, 1); assert.equal(stats.chat, 1); assert.equal(stats.active, 0);
  assert.ok(!JSON.stringify(stats).includes(actor));
});
