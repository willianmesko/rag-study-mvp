import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { workspaceFixture } from "./workspace-fixture";

const empty = { indexedDocuments: 0, passages: 0, processingJobs: 0, failedJobs: 0 };
const ready = { ...empty, indexedDocuments: 1, passages: 3 };
const workspaceId = "11111111-1111-4111-a111-111111111111";

function trackQuestionRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/\/v1\/(qa\/(stream|compare)|search)(?:[/?]|$)/.test(request.url())) requests.push(request.url());
  });
  return requests;
}

async function accessible(page: Page, info: TestInfo) {
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  await info.attach("chat-entry-accessibility", { body: JSON.stringify(audit), contentType: "application/json" });
  expect(audit.violations.map(({ id, nodes }) => ({ id, elements: nodes.map(({ target }) => target) }))).toEqual([]);
}

test("Ask is the first unnumbered destination and the default signed-in entry", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  await page.goto("/");
  await expect(page).toHaveURL(/\/ask$/);
  const navigation = page.getByRole("navigation", { name: /Main navigation|Navegação principal/ });
  const names = await navigation.getByRole("button").allTextContents();
  expect(names.map((name) => name.trim())).toEqual(
    test.info().project.name === "mobile-pt"
      ? ["Perguntar", "Buscar", "Histórico", "Espaço de trabalho", "Ajuda"]
      : ["Ask", "Search", "History", "Workspace", "Help"]
  );
  await expect(navigation.getByRole("button").first()).toHaveAttribute("aria-current", "page");
  expect(await page.locator('link[rel="icon"]').getAttribute("href")).toBe("/brand/lumora-mark.svg?v=2");
  expect(await page.locator('.brand-mark img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
});

test("an empty workspace offers upload in chat, follows preparation and unlocks grounded questions", async ({ page, context }, info) => {
  await workspaceFixture().attach(context);
  let status = empty;
  let uploads = 0;
  const requests = trackQuestionRequests(page);
  await context.route("**/v1/knowledge/status", (route) => {
    expect(route.request().headers()["x-workspace-id"]).toBe(workspaceId);
    return route.fulfill({ json: status });
  });
  await context.route("**/v1/admin/uploads", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-workspace-id"]).toBe(workspaceId);
    uploads++;
    status = { ...empty, processingJobs: 1 };
    return route.fulfill({ status: 202, json: { job: { id: "fixture-job", status: "queued" } } });
  });
  await page.goto("/ask");
  await expect(page.getByRole("heading", { name: /Start with your first document|Comece pelo seu primeiro documento/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /What would you like to know|O que você gostaria de saber/ })).toHaveCount(0);
  expect(requests).toEqual([]);
  await accessible(page, info);
  if (process.platform === "linux" && process.arch === "x64") await expect(page).toHaveScreenshot("chat-empty.png", { fullPage: true });
  const add = page.getByRole("button", { name: /^(Add documents|Adicionar documentos)$/ });
  await add.click();
  const dialog = page.getByRole("dialog", { name: /Add documents|Adicionar documentos/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Documents stay|documentos ficam|selected workspace/).first()).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({ name: "team-guide.md", mimeType: "text/markdown", buffer: Buffer.from("# Our team\nAccess requests need a manager's approval.") });
  expect(uploads, "Selecting a file must not upload or call a provider").toBe(0);
  await dialog.getByRole("button", { name: /Send for processing|Enviar para processamento/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: /Milo is preparing your documents|Milo está preparando seus documentos/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /View processing|Ver processamento/ })).toBeVisible();
  expect(uploads).toBe(1);
  expect(requests).toEqual([]);
  status = ready;
  const composer = page.getByRole("textbox", { name: /What would you like to know|O que você gostaria de saber/ });
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /^(Add documents|Adicionar documentos)$/ })).toHaveAttribute("aria-haspopup", "dialog");
  await expect(page.getByRole("button", { name: /^(Send message|Enviar mensagem)$/ })).toBeDisabled();
  expect(requests).toEqual([]);
  // The existing composer, source validation and streaming tests cover sending;
  // becoming ready itself must never automatically submit a paid question.
});

test("a viewer sees useful empty-library guidance without an upload action", async ({ page, context }, info) => {
  await workspaceFixture(undefined, "viewer").attach(context);
  const requests = trackQuestionRequests(page);
  await context.route("**/v1/knowledge/status", (route) => route.fulfill({ json: empty }));
  await page.goto("/ask");
  await expect(page.getByText(/Ask an owner or editor|Peça a um proprietário ou editor/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Add documents|Adicionar documentos/ })).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveCount(0);
  expect(requests).toEqual([]);
  await accessible(page, info);
});

test("readiness failures offer retry and never pretend the library is empty", async ({ page, context }) => {
  await workspaceFixture(undefined, "editor").attach(context);
  const requests = trackQuestionRequests(page);
  let failed = true;
  await context.route("**/v1/knowledge/status", (route) => failed
    ? route.fulfill({ status: 503, json: { error: "Fixture unavailable" } })
    : route.fulfill({ json: { ...empty, failedJobs: 1 } }));
  await page.goto("/ask");
  await expect(page.getByRole("heading", { name: /Let’s check your library|Vamos conferir seus documentos/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Add documents|Adicionar documentos/ })).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: /Try again|Tentar novamente/ }).click();
  await expect(page.getByRole("heading", { name: /Your documents need attention|Seus documentos precisam de atenção/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /View processing|Ver processamento/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Add documents|Adicionar documentos/ })).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("an empty public demo starts at Ask and routes document owners to sign in", async ({ page, context }) => {
  const requests = trackQuestionRequests(page);
  await context.route("https://fixture.supabase.co/**", (route) => route.abort());
  await context.route("**/health", (route) => route.fulfill({ json: { status: "ok" } }));
  await context.route("**/v1/knowledge/status", (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    expect(route.request().headers()["x-workspace-id"]).toBeUndefined();
    return route.fulfill({ json: empty });
  });
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: /This demo library is empty|Esta biblioteca de demonstração está vazia/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Add documents|Adicionar documentos/ })).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: /^(Sign in|Entrar)$/ }).last().click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
