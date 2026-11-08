import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { actorFromToken, dimensions, key, samples, statement, tokenFor, uuid, vectorFor } from "../../scripts/capacity/fixtures.mjs";
import { assertImage, containerOrigin } from "../../scripts/capacity/docker-lab.mjs";
import { assertSources, decodeFrame, safePlan } from "../../scripts/capacity/traffic.mjs";
import { createFixtureServer } from "../../scripts/capacity/provider.mjs";

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
});
test("Linux fixture endpoints come only from the owned private network and never publish host ports", () => {
  const info = (ip, bindings = {}) => ({ NetworkSettings: { Networks: { owned: { IPAddress: ip } } }, HostConfig: { PortBindings: bindings } });
  assert.equal(containerOrigin(info("172.18.0.2"), "owned", 5432), "http://172.18.0.2:5432");
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
