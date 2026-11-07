import { writeFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import budget from "../../config/frontend-performance-budget.json";
import { durableFixture, response } from "./durable-fixture";

function operation(url: string) {
  const path = new URL(url).pathname;
  if (path === "/health") return "health";
  if (path === "/v1/workspaces") return "workspaces";
  if (path.endsWith("/onboarding")) return "onboarding";
  if (path === "/v1/qa/models") return "models";
  if (path === "/v1/knowledge/status") return "knowledgeStatus";
  if (path === "/v1/admin/documents") return "documents";
  if (path === "/v1/admin/uploads") return "ingestionJobs";
  if (path.endsWith("/members")) return "members";
  if (path === "/v1/conversations") return "conversations";
  if (path.endsWith("/messages")) return "messages";
  if (path.endsWith("/cancel")) return "cancel";
  if (path === "/v1/qa/stream") return "admission";
  if (path.includes("/events")) return "streamResume";
  if (path.includes("/runs/")) return "runStatus";
  return path.startsWith("/v1/") ? "otherApi" : null;
}
function requests(page: Page) {
  const counts: Record<string, number> = {};
  page.on("request", (request) => {
    const key = operation(request.url()); if (key) counts[key] = (counts[key] ?? 0) + 1;
  });
  return counts;
}
async function record(page: Page, info: TestInfo, workload: string, measurements: unknown) {
  const browser = page.context().browser();
  const payload = { version: 1, kind: "lumora.frontend-browser", workload, source: process.env.GITHUB_SHA ?? null,
    localWorktree: !process.env.CI, environment: { node: process.version, platform: process.platform, arch: process.arch,
      browser: browser?.version(), project: info.project.name, viewport: page.viewportSize(),
      scope: "Synthetic API/SSE fixtures, no paid provider, no CPU/network throttling; not field LCP or a production-speed claim." }, measurements };
  const file = info.outputPath("frontend-performance.json"); await writeFile(file, JSON.stringify(payload, null, 2) + "\n");
  await info.attach("frontend-performance", { path: file, contentType: "application/json" });
}

for (const [route, heading] of [
  ["/sign-in", /Sign in to Lumora|Entre no Lumora/],
  ["/ask", /Chat with Milo|Converse com o Milo/],
  ["/workspace/knowledge", /^(Documents|Documentos)$/],
  ["/workspace/team", /Workspace members|Pessoas no espaço/],
] as const) {
  test(`FE-10 route profile ${route}`, async ({ page, context }, info) => {
    if (route === "/sign-in") await context.route("https://fixture.supabase.co/**", (request) => request.abort());
    else {
      await durableFixture().attach(context);
      await context.route("**/v1/admin/documents", (request) => request.fulfill({ json: { documents: Array.from({ length: 20 }, (_, i) => ({
        id: `77777777-7777-4777-a777-${String(i).padStart(12, "0")}`, source: `synthetic/handbook-${i}.md`, title: `Synthetic handbook ${i}`,
        chunkCount: 2, createdAt: "2026-11-07T12:00:00.000Z", updatedAt: "2026-11-07T12:00:00.000Z", format: "text", language: "en",
      })) } }));
      await context.route("**/v1/knowledge/status", (request) => request.fulfill({ json: { indexedDocuments: 20, passages: 40, processingJobs: 0, failedJobs: 0 } }));
    }
    const counts = requests(page);
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const measured = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      return { domInteractiveMs: navigation.domInteractive, loadEventMs: navigation.loadEventEnd,
        scriptRequests: resources.filter((entry) => new URL(entry.name).pathname.endsWith(".js")).length,
        stylesheetRequests: resources.filter((entry) => new URL(entry.name).pathname.endsWith(".css")).length,
        imageRequests: resources.filter((entry) => entry.initiatorType === "img").length,
        loadedJavaScriptBodyBytes: resources.filter((entry) => new URL(entry.name).pathname.endsWith(".js")).reduce((sum, entry) => sum + entry.encodedBodySize, 0),
        loadedImageBodyBytes: resources.filter((entry) => entry.initiatorType === "img").reduce((sum, entry) => sum + entry.encodedBodySize, 0),
        domElements: document.querySelectorAll("*").length };
    });
    // Compare operation counts, never raw URLs, questions or user identifiers.
    expect(counts).toEqual(budget.routes[route]);
    await record(page, info, route, { ...measured, apiRequests: counts });
  });
}

const transcript = (page: Page) => page.getByRole("region", { name: /Conversation messages|Mensagens da conversa/ });

test("FE-10 profiles a long history and paced stream while preserving reading and pinned scroll", async ({ page, context }, info) => {
  const fixture = durableFixture(), row = fixture.create(undefined, "Performance fixture");
  for (let i = 1; i <= 75; i++) fixture.turn(row.summary.id, `Synthetic message ${i}`);
  await fixture.attach(context);
  const chunks = Array.from({ length: 80 }, (_, i) => `Part ${i + 1}. `);
  const { usage: _usage, ...base } = response;
  const answer = { ...base, answer: chunks.join("") };
  await context.route("**/v1/qa/stream", (route) => {
    const input = route.request().postDataJSON(); fixture.submissions.push(input);
    fixture.turn(input.conversationId, input.question, input.runId).answer = answer;
    return route.fulfill({ contentType: "text/event-stream", body: 'id: 1\nevent: accepted\ndata: {"type":"accepted"}\n\n' });
  });
  await context.addInitScript(({ chunks, answer }) => {
    const original = window.fetch;
    const profile = { chunks: 0, firstChunkMs: 0, deliveryMs: 0, longTaskSupported: PerformanceObserver.supportedEntryTypes.includes("longtask"), frameIntervalsMs: [] as number[], longTasksMs: [] as number[] };
    Object.assign(window, { syntheticStreamProfile: profile });
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      if (!String(input).endsWith("/v1/qa/stream") || init?.method !== "POST") return response;
      void response.body?.cancel();
      const started = performance.now(); let frame = started, done = false;
      const observeFrame = (now: number) => { if (done) return; if (now > frame) profile.frameIntervalsMs.push(now - frame); frame = now; requestAnimationFrame(observeFrame); };
      requestAnimationFrame(observeFrame);
      let observer: PerformanceObserver | undefined;
      if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
        observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) profile.longTasksMs.push(entry.duration); });
        observer.observe({ type: "longtask" });
      }
      let timer: ReturnType<typeof setTimeout>, abort: () => void;
      const frames = [{ type: "accepted" }, { type: "citations", sources: answer.sources }, ...chunks.map((delta) => ({ type: "token", delta })), { type: "completed", response: answer }];
      return new Response(new ReadableStream({
        start(controller) {
          let index = 0;
          const send = () => {
            if (init.signal?.aborted) return;
            const event = frames[index++];
            controller.enqueue(new TextEncoder().encode(`id: ${index}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
            if (event.type === "token") { profile.chunks++; if (profile.chunks === 1) profile.firstChunkMs = performance.now() - started; }
            if (event.type === "completed") { done = true; observer?.disconnect(); profile.deliveryMs = performance.now() - started; controller.close(); return; }
            timer = setTimeout(send, 20);
          };
          abort = () => { done = true; clearTimeout(timer); observer?.disconnect(); controller.error(init.signal?.reason); };
          init.signal?.addEventListener("abort", abort, { once: true }); send();
        },
        cancel() { done = true; clearTimeout(timer); observer?.disconnect(); init.signal?.removeEventListener("abort", abort); },
      }), { headers: { "content-type": "text/event-stream" } });
    };
  }, { chunks, answer });
  const counts = requests(page);
  await page.goto(`/ask?conversation=${row.summary.id}`);
  await expect(transcript(page).locator("ol > li")).toHaveCount(25);
  for (const expected of [50, 75]) {
    await transcript(page).getByRole("button", { name: /Load older messages|Carregar mensagens anteriores/ }).click();
    await expect(transcript(page).locator("ol > li")).toHaveCount(expected);
  }
  expect(counts.messages).toBe(budget.longHistory.initialMessageReads);
  const historyDom = await transcript(page).locator("*").count();
  await page.getByRole("textbox", { name: /What would you like to know|O que você gostaria de saber/ }).fill("Summarize the synthetic handbook.");
  await page.getByRole("button", { name: /^(Send message|Enviar mensagem)$/ }).click();
  const progress = () => page.evaluate(() => (window as unknown as { syntheticStreamProfile: { chunks: number } }).syntheticStreamProfile.chunks);
  await expect.poll(progress).toBeGreaterThanOrEqual(5);
  await transcript(page).evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
  await expect.poll(progress).toBeGreaterThanOrEqual(20);
  expect(await transcript(page).evaluate((el) => el.scrollTop)).toBe(0);
  await page.getByRole("button", { name: /Latest message|Mensagem mais recente/ }).click();
  await expect(transcript(page).getByText(answer.answer, { exact: true })).toBeVisible();
  await expect(transcript(page).locator("ol > li")).toHaveCount(76);
  await expect.poll(() => counts.messages).toBe(budget.longHistory.totalMessageReadsAfterStream);
  expect(counts.admission).toBe(budget.longHistory.admissions); expect(counts.runStatus ?? 0).toBe(budget.longHistory.runStatusReads); expect(counts.streamResume ?? 0).toBe(budget.longHistory.streamResumes);
  expect(fixture.submissions).toHaveLength(1); expect(row.turns).toHaveLength(76);
  expect(await transcript(page).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(64);
  const profile = await page.evaluate(() => (window as unknown as { syntheticStreamProfile: object }).syntheticStreamProfile);
  await record(page, info, "75-turn-paced-stream", { apiRequests: counts, historyTurns: 75, retainedTurns: 76, historyDomElements: historyDom,
    streamChunks: 80, cadenceMs: 20, readingPositionPreserved: true, pinnedScrollPreserved: true, profile });
});
