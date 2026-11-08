import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { chatRunEventSchema, searchResponseSchema } from "@rag-study/contracts";
import { key, samples, statement, tokenFor, vectorFor } from "./fixtures.mjs";

export const headersFor = (workspace, actor = workspace.actors[0]) => ({
  authorization: `Bearer ${tokenFor(actor)}`, "x-workspace-id": workspace.tenantId
});
export async function jsonResponse(url, options = {}) {
  const response = await fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
  const text = await response.text();
  assert.ok(Buffer.byteLength(text) <= 128 * 1024, "Fixture response exceeded its bound.");
  return { status: response.status, body: JSON.parse(text) };
}
export function assertSources(sources, workspace, documents, chunks) {
  assert.ok(sources.length > 0, "The synthetic question must have a grounded source.");
  for (const source of sources) {
    assert.equal(documents.get(source.documentId), workspace.tenantId, "Cross-workspace source detected.");
    if (chunks) {
      assert.equal(chunks.get(source.chunkId)?.tenantId, workspace.tenantId, "Cross-workspace chunk detected.");
      assert.equal(chunks.get(source.chunkId)?.documentId, source.documentId, "Chunk/document association changed.");
    }
  }
}
export async function verifySources(sources, workspace, corpus) {
  if (sources.some(({ documentId, chunkId }) => !corpus.documents.has(documentId) || !corpus.chunks.has(chunkId))) {
    assert.equal(typeof corpus.hydrateSourceOwners, "function", "Unknown sources require authoritative fixture ownership.");
    await corpus.hydrateSourceOwners(workspace.tenantId, sources);
  }
  assertSources(sources, workspace, corpus.documents, corpus.chunks);
}
export function decodeFrame(frame) {
  const data = frame.split("\n").filter((line) => line.startsWith("data: "));
  if (!data.length) return null; // Heartbeats carry no product event.
  assert.equal(data.length, 1, "Unexpected multi-line product event.");
  return chatRunEventSchema.parse(JSON.parse(data[0].slice(6)));
}
export function safePlan(node) {
  const names = ["Node Type", "Relation Name", "Index Name", "Plan Rows", "Actual Rows", "Actual Loops", "Actual Total Time",
    "Shared Hit Blocks", "Shared Read Blocks", "Temp Read Blocks", "Temp Written Blocks"];
  return { ...Object.fromEntries(names.filter((name) => Object.hasOwn(node, name)).map((name) => [name, node[name]])),
    ...(Array.isArray(node.Plans) ? { Plans: node.Plans.map(safePlan) } : {}) };
}
async function streamAnswer(base, workspace, actor, question, corpus, cancellation) {
  const started = performance.now(), signal = AbortSignal.any([cancellation, AbortSignal.timeout(15_000)]);
  const response = await fetch(base + "/v1/qa/stream", {
    method: "POST", headers: { ...headersFor(workspace, actor), "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ question, topK: 5, runId: randomUUID(), modelId: "default" }), signal
  });
  assert.equal(response.status, 200, "Synthetic stream admission failed.");
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.ok(response.body);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", bytes = 0, firstEvent = null, firstText = null, result;
  try {
    while (!result) {
      const { done, value } = await reader.read();
      bytes += value?.byteLength ?? 0;
      assert.ok(bytes <= 128 * 1024, "Synthetic stream exceeded its bound.");
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const event = decodeFrame(frame);
        if (!event) continue;
        firstEvent ??= performance.now() - started;
        assert.ok(!["error", "cancelled"].includes(event.type), "Synthetic stream terminated without an answer.");
        if (event.type === "citations") await verifySources(event.sources, workspace, corpus);
        if (event.type === "token" && event.delta) firstText ??= performance.now() - started;
        if (event.type === "completed") result = event.response;
      }
      if (done) break;
    }
    assert.ok(result, "Synthetic stream ended before completion.");
    assert.equal(result.refusalReason ?? null, null, "The grounded synthetic question was refused.");
    assert.equal(result.answer, statement);
    await verifySources(result.sources, workspace, corpus);
    if (result.contextSources?.length) await verifySources(result.contextSources, workspace, corpus);
    return { completion: performance.now() - started, firstEvent, firstText, cacheHit: result.cacheHit === true };
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export async function referenceRecall(base, pool, corpus) {
  const measurements = [];
  for (const [index, workspace] of corpus.workspaces.entries()) {
    for (const ordinal of [3, 31, 67]) {
      const query = `${key(ordinal)} ${index === 1 ? "qual é o procedimento de retenção?" : "what is the retention procedure?"}`;
      const literal = `[${vectorFor(query).join(",")}]`;
      // + 0 forces exact sorting rather than claiming ANN as its own reference.
      const exact = await pool.query(`SELECT c.id FROM chunks c JOIN documents d ON d.id=c.document_id
        WHERE d.tenant_id=$1 ORDER BY (c.embedding <=> $2::vector) + 0, c.id LIMIT 5`, [workspace.tenantId, literal]);
      const response = await jsonResponse(base + "/v1/search?" + new URLSearchParams({ q: query, topK: "5" }), { headers: headersFor(workspace) });
      assert.equal(response.status, 200);
      const results = searchResponseSchema.parse(response.body).results;
      await verifySources(results, workspace, corpus);
      const actual = new Set(results.map(({ chunkId }) => chunkId));
      let plans;
      if (ordinal === 3) {
        const sql = `SELECT c.id FROM chunks c JOIN documents d ON d.id=c.document_id
          WHERE d.tenant_id=$1 ORDER BY c.embedding <=> $2::vector LIMIT 20`;
        const plan = await pool.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, [workspace.tenantId, literal]);
        plans = safePlan(plan.rows[0]["QUERY PLAN"][0].Plan);
      }
      measurements.push({ language: index === 1 ? "pt" : "en", workspace: index, recallAt5: exact.rows.filter(({ id }) => actual.has(id)).length / 5,
        ...(plans ? { vectorCandidatePlan: plans } : {}) });
    }
  }
  return measurements;
}
export async function trafficPhase(base, corpus, { name, seconds, clients = 2, signal = new AbortController().signal }) {
  const end = performance.now() + seconds * 1000, search = [], completion = [], firstEvent = [], firstText = [];
  const stopped = new AbortController(), cancellation = AbortSignal.any([signal, stopped.signal]);
  const perWorkspace = corpus.workspaces.map(() => ({ search: [], completion: [] }));
  let fatal;
  let attempted = 0, failed = 0, cacheHits = 0;
  const failureCodes = {};
  await Promise.all(Array.from({ length: clients }, (_, client) => (async () => {
    let iteration = client;
    while (performance.now() < end && !cancellation.aborted) {
      const workspace = corpus.workspaces[iteration % corpus.workspaces.length];
      const actor = workspace.actors[1 + iteration % (workspace.actors.length - 1)];
      const query = `${key(iteration % 90)} ${workspace === corpus.workspaces[1] ? "qual é o procedimento de retenção?" : "what is the retention procedure?"}`;
      attempted++;
      try {
        const started = performance.now();
        const response = await jsonResponse(base + "/v1/search?" + new URLSearchParams({ q: query, topK: "5" }), { headers: headersFor(workspace, actor), signal: cancellation });
        assert.equal(response.status, 200, "Synthetic search admission failed.");
        const searchTime = performance.now() - started;
        await verifySources(searchResponseSchema.parse(response.body).results, workspace, corpus);
        search.push(searchTime); perWorkspace[iteration % corpus.workspaces.length].search.push(searchTime);
        const stream = await streamAnswer(base, workspace, actor, query, corpus, cancellation);
        completion.push(stream.completion);
        perWorkspace[iteration % corpus.workspaces.length].completion.push(stream.completion);
        if (stream.firstEvent !== null) firstEvent.push(stream.firstEvent);
        if (stream.firstText !== null) firstText.push(stream.firstText);
        if (stream.cacheHit) cacheHits++;
      } catch (error) {
        failed++;
        const reason = error instanceof assert.AssertionError ? "assertion_failed" : error?.name === "TimeoutError" ? "deadline" : "request_failed";
        failureCodes[reason] = (failureCodes[reason] ?? 0) + 1;
        // A scope/citation assertion must fail the pilot, never be hidden as latency.
        if (error instanceof assert.AssertionError) { fatal ??= error; stopped.abort(); }
      }
      iteration += clients; await delay(150);
    }
  })()));
  if (fatal) throw fatal;
  signal.throwIfAborted();
  return { name, seconds, clients, attempted, failed, failureCodes, cacheHits, searchMs: samples(search),
    completedMs: samples(completion), firstEventMs: samples(firstEvent), firstValidatedTextMs: samples(firstText),
    perWorkspace: perWorkspace.map((values, workspace) => ({ workspace, searchMs: samples(values.search), completedMs: samples(values.completion) })) };
}
export async function uploadBurst(base, workspace, count = 6, signal = new AbortController().signal) {
  const ids = [];
  for (let index = 0; index < count; index++) {
    signal.throwIfAborted();
    const upload = async () => {
      const form = new FormData();
      form.set("file", new Blob([`# Synthetic retention guide\n\n${key(90000 + index)}. ${statement}\n`], { type: "text/markdown" }), `guide-${index}.md`);
      return jsonResponse(base + "/v1/admin/uploads", { method: "POST", headers: {
        ...headersFor(workspace), "x-document-source": `capacity/upload-${index}.md`, "idempotency-key": `capacity_upload_${String(index).padStart(6, "0")}`
      }, body: form, signal });
    };
    const first = await upload(), repeat = await upload();
    assert.equal(first.status, 202); assert.equal(repeat.status, 202);
    assert.equal(first.body.job.id, repeat.body.job.id, "Upload replay produced a duplicate job.");
    ids.push(first.body.job.id);
    await delay(500);
  }
  return ids;
}
export async function verifyIngestedSources(base, corpus, count, signal) {
  const workspace = corpus.workspaces[0];
  for (let index = 0; index < count; index++) {
    signal.throwIfAborted();
    const question = key(90000 + index) + " what is the retention procedure?";
    const response = await jsonResponse(base + "/v1/search?" + new URLSearchParams({ q: question, topK: "1" }), {
      headers: headersFor(workspace), signal
    });
    assert.equal(response.status, 200);
    const sources = searchResponseSchema.parse(response.body).results;
    assert.equal(sources.length, 1); assert.equal(sources[0].source, `capacity/upload-${index}.md`);
    await verifySources(sources, workspace, corpus);
    await streamAnswer(base, workspace, workspace.actors[1], question, corpus, signal);
  }
  return { searches: count, answers: count, newlyIngestedSourcesChecked: count };
}
