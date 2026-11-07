import { expect, test, type Page } from "@playwright/test";
import type { UploadJob } from "@rag-study/contracts";
import { workspaceFixture } from "./workspace-fixture";

const job: UploadJob = {
  id: "55555555-5555-4555-a555-555555555555", source: "handbook.md", title: "Team handbook",
  filename: "handbook.md", mimeType: "text/markdown", status: "processing", progress: 30,
  error: null, chunkCount: null, highRiskChunks: null,
  createdAt: "2026-11-07T12:00:00.000Z", updatedAt: "2026-11-07T12:00:00.000Z",
};

async function controlTime(page: Page) {
  await page.clock.runFor(100);
}

function navigation(page: Page) {
  return page.getByRole("navigation", { name: /Workspace sections|Seções do espaço de trabalho/ });
}

// Counters observe product requests, rather than implementation details of Query.
test("settled document and job lists stay idle; usage refresh stops after leaving its section", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  await page.clock.install();
  let documents = 0, jobs = 0, usage = 0, effects = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/v1/admin/documents") documents++;
    if (path === "/v1/admin/uploads" && request.method() === "GET") jobs++;
    if (path === "/v1/admin/usage") usage++;
    if (/\/v1\/(qa|admin\/(uploads|evaluations))/.test(path) && request.method() !== "GET") effects++;
  });
  await page.goto("/workspace/knowledge");
  await expect(page.getByRole("heading", { name: /^(Documents|Documentos)$/ })).toBeVisible();
  await expect.poll(() => documents).toBe(1);
  await expect.poll(() => jobs).toBe(1);
  await controlTime(page);
  await page.clock.fastForward(18_000);
  expect({ documents, jobs }).toEqual({ documents: 1, jobs: 1 });
  await navigation(page).getByRole("button", { name: /Usage|Uso/ }).click();
  await expect.poll(() => usage).toBe(1);
  await page.clock.fastForward(30_100);
  await expect.poll(() => usage).toBe(2);
  await navigation(page).getByRole("button", { name: /Team|Equipe/ }).click();
  await expect(page.getByRole("heading", { name: /^(Workspace members|Pessoas no espaço)$/ })).toBeVisible();
  const settledUsage = usage;
  await page.clock.fastForward(65_000);
  expect(usage).toBe(settledUsage);
  expect(effects).toBe(0);
});

test("one workspace monitor refreshes filtered and unfiltered documents once at terminal revision", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  await page.clock.install();
  let completed = false, jobReads = 0, filtered = 0, unfiltered = 0;
  await context.route("**/v1/admin/uploads", (route) => {
    jobReads++;
    return route.fulfill({ json: { jobs: [{ ...job, ...(completed ? { status: "completed", progress: 100, chunkCount: 2, updatedAt: "2026-11-07T12:01:00.000Z" } : {}) }] } });
  });
  await context.route("**/v1/admin/documents**", (route) => {
    if (new URL(route.request().url()).search) filtered++; else unfiltered++;
    return route.fulfill({ json: { documents: [] } });
  });
  await page.goto("/workspace/knowledge");
  await expect.poll(() => unfiltered).toBe(1);
  await page.getByRole("textbox", { name: /Filter documents|Filtrar documentos/ }).fill("handbook");
  await expect.poll(() => filtered).toBe(1);
  await controlTime(page);
  const baseline = { filtered, unfiltered, jobReads };
  completed = true;
  await page.clock.fastForward(3_100);
  await expect.poll(() => jobReads).toBe(baseline.jobReads + 1);
  await expect.poll(() => filtered).toBe(baseline.filtered + 1);
  await expect.poll(() => unfiltered).toBe(baseline.unfiltered + 1);
  const terminal = { filtered, unfiltered, jobReads };
  await page.clock.fastForward(18_000);
  expect({ filtered, unfiltered, jobReads }).toEqual(terminal);
});

for (const status of [401, 403, 429, 200]) {
  test(`job failures stop polling and an explicit retry recovers (${status})`, async ({ page, context }) => {
    await workspaceFixture().attach(context);
  await page.clock.install();
    let requests = 0, recover = false;
    await context.route("**/v1/admin/uploads", (route) => {
      requests++;
      return route.fulfill(recover ? { json: { jobs: [] } } : { status, json: status === 200 ? { jobs: "invalid" } : { error: "Fixture read denied." } });
    });
    await page.goto("/workspace/processing");
    await expect(page.getByRole("alert")).toBeVisible();
    await controlTime(page);
    const initial = requests;
    await page.clock.fastForward(18_000);
    expect(requests).toBe(initial);
    recover = true;
    await page.getByRole("button", { name: /^(Try again|Tentar novamente)$/ }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(requests).toBe(initial + 1);
  });
}

test("evaluations wait quietly for approval and resume polling only during active work", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  await page.clock.install();
  let reads = 0, state = "waiting_approval", approvals = 0;
  const workflow = () => ({
    runId: job.id, kind: "evaluation", version: "evaluation-v2", status: state, stage: "approval",
    steps: 1, calls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0,
    budget: { maxSteps: 50, maxCalls: 32, maxInputTokens: 500000, maxOutputTokens: 16000, maxCostMicros: 200000, timeoutMs: 120000 },
    attempts: 1, errorCode: null, resultId: null, createdAt: job.createdAt, updatedAt: job.updatedAt, expiresAt: "2026-11-08T12:00:00.000Z",
  });
  await context.route("**/v1/admin/evaluations?*", (route) => {
    reads++;
    return route.fulfill({ json: { runs: [], workflowAvailable: true, workflows: [workflow()] } });
  });
  await context.route("**/v1/admin/evaluation-workflows/*/approve", (route) => {
    approvals++;
    state = "running";
    return route.fulfill({ json: { workflow: workflow() } });
  });
  await page.goto("/workspace/evaluations");
  await expect(page.getByRole("button", { name: /Approve|Aprovar/ })).toBeVisible();
  await controlTime(page);
  const initial = reads;
  await page.clock.fastForward(18_000);
  expect(reads).toBe(initial);
  expect(approvals).toBe(0);
  await page.getByRole("button", { name: /Approve|Aprovar/ }).click();
  await expect.poll(() => reads).toBe(initial + 1);
  await page.clock.fastForward(3_100);
  await expect.poll(() => reads).toBe(initial + 2);
  state = "completed";
  await page.clock.fastForward(3_100);
  await expect.poll(() => reads).toBe(initial + 3);
  await expect(page.getByRole("button", { name: /^(Run evaluation|Executar avaliação)$/ })).toBeEnabled();
  await page.clock.fastForward(18_000);
  expect(reads).toBe(initial + 3);
  expect(approvals).toBe(1);
});

test("resource reads abort on section disposal and have a finite deadline", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  await page.addInitScript(() => {
    const original = window.fetch;
    const aborted: string[] = [];
    Object.assign(window, { resourceAborts: aborted });
    window.fetch = (input, init) => {
      const path = String(input);
      if (path.includes("/v1/admin/documents")) init?.signal?.addEventListener("abort", () => aborted.push(path), { once: true });
      return original(input, init);
    };
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await context.route("**/v1/admin/documents**", async (route) => {
    await held;
    await route.fulfill({ json: { documents: [] } }).catch(() => {});
  });
  try {
    await page.goto("/workspace/knowledge");
    await expect(page.getByText(/Loading documents|Carregando documentos/)).toBeVisible();
    await navigation(page).getByRole("button", { name: /Team|Equipe/ }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { resourceAborts: string[] }).resourceAborts.length)).toBe(1);
    await navigation(page).getByRole("button", { name: /Documents|Documentos/ }).click();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => (window as unknown as { resourceAborts: string[] }).resourceAborts.length)).toBe(2);
  } finally { release(); }
});


test("offline reads pause and reconnect without repeating a provider action", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  let filtered = 0, effects = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/v1/admin/documents" && url.search) filtered++;
    if (url.pathname.startsWith("/v1/") && request.method() !== "GET") effects++;
  });
  await page.goto("/workspace/knowledge");
  await expect(page.getByText(/No documents are ready|Ainda não há documentos/)).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("textbox", { name: /Filter documents|Filtrar documentos/ }).fill("offline");
  // Wait for the debounce in the real UI; the new query is paused by Query's online manager.
  await expect(page.getByRole("textbox", { name: /Filter documents|Filtrar documentos/ })).toHaveValue("offline");
  await page.waitForTimeout(350);
  expect(filtered).toBe(0);
  await context.setOffline(false);
  await expect.poll(() => filtered).toBe(1);
  expect(effects).toBe(0);
});
