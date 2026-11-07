import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { workspaceFixture } from "./workspace-fixture";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const documentId = "77777777-7777-4777-a777-777777777777";
const date = "2026-11-06T12:00:00.000Z";
const document = { id: documentId, title: "Team handbook", source: "team/handbook", chunkCount: 2, createdAt: date, updatedAt: date, hasOriginal: true, format: "pdf", language: "en" };
const completed = { id: "88888888-8888-4888-a888-888888888888", source: document.source, title: document.title, filename: "handbook.pdf", mimeType: "application/pdf", status: "completed", progress: 100, error: null, chunkCount: 2, highRiskChunks: 0, createdAt: date, updatedAt: date };

async function contentFixture(context: BrowserContext) {
  await workspaceFixture().attach(context);
  let documents = [document];
  let jobs = [completed,
    { ...completed, id: "99999999-9999-4999-a999-999999999999", title: "Service guide", status: "processing", progress: 40 },
    { ...completed, id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", title: "Request checklist", status: "failed", progress: 30, error: "extraction_failed" }
  ];
  const calls = { chunks: 0, original: 0, events: 0, uploads: 0, imports: 0, retries: 0, reindexes: 0, deletes: 0 };
  await context.route("**/v1/admin/**", async (route) => {
    const request = route.request();
    expect(request.headers()).toMatchObject({ authorization: "Bearer fixture-workspace-token", "x-workspace-id": workspaceId });
    const { pathname } = new URL(request.url());
    if (pathname === "/v1/admin/documents") return route.fulfill({ json: { documents } });
    if (pathname === "/v1/admin/uploads" && request.method() === "GET") return route.fulfill({ json: { jobs } });
    if (pathname.endsWith("/chunks")) {
      calls.chunks++;
      return route.fulfill({ json: { chunks: [0, 1].map((ordinal) => ({ id: `passage-${ordinal}`, ordinal, content: `Handbook passage ${ordinal + 1}.`, createdAt: date, security: { promptInjectionRisk: "low", signals: [] } })) } });
    }
    if (pathname.endsWith("/original")) {
      calls.original++;
      return route.fulfill({ contentType: "application/pdf", headers: { "content-disposition": "attachment; filename*=UTF-8''handbook.pdf", "cache-control": "no-store" }, body: "%PDF-1.4\nfixture" });
    }
    if (pathname.endsWith("/events")) {
      calls.events++;
      return route.fulfill({ json: { events: [{ id: "stage-1", stage: "chunking", status: "completed", durationMs: 25, details: { chunkCount: 2 }, createdAt: date }] } });
    }
    if (pathname === "/v1/admin/uploads" && request.method() === "POST") {
      calls.uploads++;
      expect(request.headers()["content-type"]).toContain("multipart/form-data");
      return route.fulfill({ status: 202, json: { job: completed } });
    }
    if (pathname === "/v1/admin/uploads/url") {
      calls.imports++;
      expect(request.postDataJSON()).toMatchObject({ url: "https://example.com/handbook" });
      return route.fulfill({ status: 202, json: { job: completed } });
    }
    if (pathname.endsWith("/reindex")) {
      calls.reindexes++;
      return route.fulfill({ json: { job: completed } });
    }
    if (pathname.endsWith("/retry")) {
      calls.retries++;
      const id = pathname.split("/").at(-2);
      jobs = jobs.map((job) => job.id === id ? { ...job, status: "queued", error: null } : job);
      return route.fulfill({ json: { jobId: id, status: "queued" } });
    }
    if (pathname === `/v1/admin/documents/${documentId}` && request.method() === "DELETE") {
      calls.deletes++;
      documents = [];
      return route.fulfill({ status: 204 });
    }
    return route.fallback();
  });
  return calls;
}

async function checkPage(page: Page) {
  const bounds = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(bounds.content).toBeLessThanOrEqual(bounds.viewport);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }))).toEqual([]);
}

test("workspace sections have one page heading and compact navigation", async ({ page, context }, info) => {
  await contentFixture(context);
  for (const section of ["overview", "knowledge", "processing", "team", "evaluations", "settings"]) {
    await page.goto(`/workspace/${section}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: /Main navigation|Navegação principal/ }).getByRole("button", { name: /^(Help|Ajuda)$/ })).toBeVisible();
    await expect(page.getByRole("navigation", { name: /Workspace sections|Seções do espaço de trabalho/ }).getByRole("button")).toHaveCount(6);
    await checkPage(page);
    if (process.platform === "linux" && process.arch === "x64" &&
      ((info.project.name === "desktop-en" && section === "knowledge") || (info.project.name === "mobile-pt" && section === "overview"))) {
      await expect(page).toHaveScreenshot(`${section}.png`, { fullPage: true });
    }
  }
});

test("documents open details and originals on demand with safe focus return", async ({ page, context }) => {
  const calls = await contentFixture(context);
  await page.goto("/workspace/knowledge");
  const title = page.getByRole("button", { name: /^Team handbook/ });
  await expect(title).toBeVisible();
  expect(calls.chunks).toBe(0);
  expect(calls.original).toBe(0);
  await title.click();
  const details = page.getByRole("dialog", { name: document.title, exact: true });
  await expect(details.getByText("Handbook passage 1.", { exact: true })).toBeVisible();
  expect(calls.chunks).toBe(1);
  expect(calls.original).toBe(0);
  const original = details.getByRole("button", { name: /Original file for|Arquivo original de/ });
  await original.click();
  await expect(details.getByRole("link", { name: /Download original|Baixar original/ })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(calls.original).toBe(1);
  await checkPage(page);
  await details.getByRole("button", { name: /Hide file|Ocultar arquivo/ }).click();
  await expect(original).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await expect(title).toBeFocused();
  const actions = page.getByRole("button", { name: /^(Actions for|Ações para) Team handbook$/ });
  await actions.click();
  await page.getByRole("menuitem", { name: /^(Reprocess|Reprocessar)$/ }).click();
  await expect.poll(() => calls.reindexes).toBe(1);
  await actions.click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("menuitem", { name: /^(Remove|Remover)$/ }).click();
  await expect(title).toHaveCount(0);
  expect(calls.deletes).toBe(1);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
});

test("adding documents uses one dialog for file upload and URL import", async ({ page, context }) => {
  const calls = await contentFixture(context);
  await page.goto("/workspace/knowledge");
  const add = page.getByRole("button", { name: /^(Add documents|Adicionar documentos)$/ });
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await add.click();
  const dialog = page.getByRole("dialog", { name: /^(Add documents|Adicionar documentos)$/ });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "handbook.txt", mimeType: "text/plain", buffer: Buffer.from("A safe sample handbook.") });
  await dialog.getByRole("button", { name: /Send for processing|Enviar para processamento/ }).click();
  await expect(dialog).toBeHidden();
  expect(calls.uploads).toBe(1);
  await add.click();
  await dialog.getByRole("button", { name: /^(Web page|Página da web)$/ }).click();
  await dialog.getByRole("textbox", { name: /Public HTTPS address|Endereço HTTPS público/ }).fill("http://example.com/handbook");
  await dialog.getByRole("button", { name: /^(Import page|Importar página)$/ }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(calls.imports).toBe(0);
  await dialog.getByRole("textbox", { name: /Public HTTPS address|Endereço HTTPS público/ }).fill("https://example.com/handbook");
  await dialog.getByRole("button", { name: /^(Import page|Importar página)$/ }).click();
  await expect(dialog).toBeHidden();
  expect(calls.imports).toBe(1);
  await expect(add).toBeFocused();
});

test("processing opens the selected timeline and retains retry actions", async ({ page, context }) => {
  const calls = await contentFixture(context);
  await page.goto("/workspace/processing");
  const title = page.getByRole("button", { name: /^Team handbook/ });
  await expect(title).toBeVisible();
  expect(calls.events).toBe(0);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await title.click();
  const details = page.getByRole("dialog", { name: document.title, exact: true });
  await expect(details.getByRole("progressbar")).toBeVisible();
  await expect.poll(() => calls.events).toBe(1);
  await expect(details.getByText(/One document can become|Um documento pode gerar/)).toBeVisible();
  await checkPage(page);
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await expect(title).toBeFocused();
  await page.getByRole("button", { name: /^(Actions for|Ações para) Request checklist$/ }).click();
  await page.getByRole("menuitem", { name: /^(Try again|Tentar novamente)$/ }).click();
  await expect.poll(() => calls.retries).toBe(1);
});

test("viewer navigation and document actions stay read-only", async ({ page, context }) => {
  await contentFixture(context);
  await context.route("**/v1/workspaces", (route) => route.fulfill({ json: { workspaces: [{ tenantId: workspaceId, tenantName: "Northstar Studio", tenantSlug: "northstar-studio", role: "viewer" }] } }));
  await page.goto("/workspace/knowledge");
  await expect(page.getByRole("button", { name: /^Team handbook/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Add documents|Adicionar documentos)$/ })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: /Workspace sections|Seções do espaço de trabalho/ }).getByRole("button")).toHaveCount(3);
  await page.getByRole("button", { name: /^(Actions for|Ações para) Team handbook$/ }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(1);
  await expect(page.getByRole("menuitem", { name: /View details|Ver detalhes/ })).toBeVisible();
});
