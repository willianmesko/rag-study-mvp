import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ProcessNextIngestionJobUseCase } from "./process-next-ingestion-job.js";
import type { IngestionJob, IngestionJobRepository } from "../ports/ingestion-job-repository.js";
import type { DocumentTextExtractor } from "../ports/document-text-extractor.js";
import type { IngestDocumentUseCase } from "./ingest-document.js";

const job: IngestionJob = { id: "job", tenantId: "workspace", documentId: null, source: "fixture.txt", title: null,
  filename: "fixture.txt", mimeType: "text/plain", payload: Buffer.from("Fixture"), storagePath: null,
  status: "processing", progress: 0, error: null, chunkCount: null, highRiskChunks: null,
  createdAt: new Date(), updatedAt: new Date() };

function fixture(t: TestContext) {
  const claim = t.mock.fn<IngestionJobRepository["claimNext"]>(async () => job);
  const complete = t.mock.fn<IngestionJobRepository["complete"]>(async () => {});
  const fail = t.mock.fn<IngestionJobRepository["fail"]>(async () => {});
  const defer = t.mock.fn<NonNullable<IngestionJobRepository["deferAdmission"]>>(async () => true);
  const jobs: Pick<IngestionJobRepository, "claimNext" | "recordEvent" | "complete" | "fail" | "deferAdmission"> = {
    claimNext: claim, recordEvent: t.mock.fn(async () => {}),
    complete, fail, deferAdmission: defer,
  };
  return { jobs, claim, complete, fail, defer };
}

function waitForAbort(signal?: AbortSignal): Promise<never> {
  assert.ok(signal);
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
}

test("pre-aborted ingestion does not claim a job", async (t) => {
  const { jobs, claim } = fixture(t); const controller = new AbortController(); controller.abort();
  const execute = new ProcessNextIngestionJobUseCase(jobs, { extract: async () => ({ text: "", metadata: {} }) },
    { execute: async () => ({ id: "document", chunkCount: 1, highRiskChunks: 0 }) }, { get: async () => Buffer.alloc(0) });
  await assert.rejects(execute.execute(controller.signal));
  assert.equal(claim.mock.callCount(), 0);
});

for (const stage of ["source", "ocr", "provider"] as const) {
  test(`shutdown abort reaches ${stage} work and never publishes completion`, async (t) => {
    const { jobs, complete, fail } = fixture(t); const controller = new AbortController();
    let started!: () => void; const active = new Promise<void>((resolve) => { started = resolve; });
    if (stage === "source") jobs.claimNext = async () => ({ ...job, payload: null, storagePath: "private/fixture" });
    const extract: DocumentTextExtractor = { extract: async (_input, _report, signal) => {
      if (stage === "ocr") { started(); await waitForAbort(signal); }
      return { text: "Fixture text", metadata: {} };
    } };
    const ingest: Pick<IngestDocumentUseCase, "execute"> = { execute: async (_input, _report, signal) => {
      if (stage === "provider") { started(); await waitForAbort(signal); }
      return { id: "document", chunkCount: 1, highRiskChunks: 0 };
    } };
    const worker = new ProcessNextIngestionJobUseCase(jobs, extract, ingest, { get: async (_path, signal) => {
      started(); return waitForAbort(signal);
    } });
    const running = worker.execute(controller.signal);
    const rejected = assert.rejects(running, { name: "AbortError" });
    await active; controller.abort(); await rejected;
    assert.equal(complete.mock.callCount(), 0);
    assert.equal(fail.mock.callCount(), 1);
    assert.match(String(fail.mock.calls[0]?.arguments[1]), /Review before retrying/);
  });
}

test("late provider completion after cancellation cannot complete the job", async (t) => {
  const { jobs, complete } = fixture(t); const controller = new AbortController();
  let finish!: () => void; let started!: () => void; const active = new Promise<void>((resolve) => { started = resolve; });
  const worker = new ProcessNextIngestionJobUseCase(jobs, { extract: async () => ({ text: "Fixture", metadata: {} }) },
    { execute: async () => { started(); await new Promise<void>((resolve) => { finish = resolve; }); return { id: "document", chunkCount: 1, highRiskChunks: 0 }; } },
    { get: async () => Buffer.alloc(0) });
  const running = worker.execute(controller.signal); const rejected = assert.rejects(running);
  await active; controller.abort(); finish(); await rejected;
  assert.equal(complete.mock.callCount(), 0);
});

test("uncertain durable enqueue during shutdown is retained for reconciliation", async (t) => {
  const { jobs, fail, defer } = fixture(t); const controller = new AbortController();
  let started!: () => void; const active = new Promise<void>((resolve) => { started = resolve; });
  const worker = new ProcessNextIngestionJobUseCase(jobs, { extract: async () => ({ text: "", metadata: {} }) },
    { execute: async () => ({ id: "unused", chunkCount: 0, highRiskChunks: 0 }) }, { get: async () => Buffer.alloc(0) }, undefined,
    async () => { started(); await waitForAbort(controller.signal); });
  const running = worker.execute(controller.signal); const rejected = assert.rejects(running);
  await active; controller.abort(); await rejected;
  assert.equal(fail.mock.callCount(), 0);
  assert.equal(defer.mock.callCount(), 0);
});

test("a shutdown after acknowledged completion cannot turn the job into a failure", async (t) => {
  const { jobs, complete, fail } = fixture(t);
  const controller = new AbortController();
  const worker = new ProcessNextIngestionJobUseCase(jobs,
    { extract: async () => ({ text: "Fixture", metadata: {} }) },
    { execute: async () => ({ id: "document", chunkCount: 1, highRiskChunks: 0 }) },
    { get: async () => Buffer.alloc(0) },
    { findSimilar: async () => null, put: async () => {}, invalidateTenant: async () => { controller.abort(); throw controller.signal.reason; } });
  await assert.rejects(worker.execute(controller.signal), { name: "AbortError" });
  assert.equal(complete.mock.callCount(), 1);
  assert.equal(fail.mock.callCount(), 0);
});
