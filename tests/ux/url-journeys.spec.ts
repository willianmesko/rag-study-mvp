import { expect, test } from "@playwright/test";
import { workspaceFixture } from "./workspace-fixture";
import { durableFixture, response } from "./durable-fixture";

const messages = (page: import("@playwright/test").Page) => page.getByRole("region", { name: /Conversation messages|Mensagens da conversa/ });
const composer = (page: import("@playwright/test").Page) => page.getByRole("textbox", { name: /What would you like to know|O que você gostaria de saber/ });

test("FE-11 Back and Forward reopen only the selected saved conversation without submitting", async ({ page, context }) => {
  const fixture = durableFixture(), first = fixture.create(undefined, "First saved chat"), second = fixture.create(undefined, "Second saved chat");
  fixture.turn(first.summary.id, "First saved question"); fixture.turn(second.summary.id, "Second saved question");
  await fixture.attach(context);
  const reads: string[] = [];
  page.on("request", (request) => { const path = new URL(request.url()).pathname; if (path.endsWith("/messages")) reads.push(path); });
  await page.goto(`/ask?conversation=${first.summary.id}&token=private-token&question=private-draft`);
  await expect(page).toHaveURL(new RegExp(`conversation=${first.summary.id}$`));
  await expect(messages(page).getByText("First saved question", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^(Chats|Conversas)$/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Second saved chat/ }).click();
  await expect(messages(page).getByText("Second saved question", { exact: true })).toBeVisible();
  await page.goBack(); await expect(messages(page).getByText("First saved question", { exact: true })).toBeVisible();
  await page.goForward(); await expect(messages(page).getByText("Second saved question", { exact: true })).toBeVisible();
  expect(reads).toHaveLength(4); expect(fixture.submissions).toEqual([]);
  expect(page.url()).not.toMatch(/private-token|private-draft|question=/);
});

test("FE-11 metadata filters survive Back and Forward while free text stays out of the URL", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  const calls: string[] = [];
  await context.route("**/v1/admin/documents**", (route) => {
    expect(route.request().headers()["x-workspace-id"]).toBe("11111111-1111-4111-a111-111111111111");
    calls.push(new URL(route.request().url()).search);
    return route.fulfill({ json: { documents: [] } });
  });
  await page.goto("/workspace/knowledge");
  await page.getByText(/^(Advanced filters|Filtros avançados)$/).click();
  const language = page.getByRole("combobox", { name: /^(Language|Idioma)$/ });
  await language.click(); await page.getByRole("option", { name: /^(Portuguese|Português)$/ }).click();
  await page.getByRole("button", { name: /^(Apply filters|Aplicar filtros)$/ }).click();
  await expect(page).toHaveURL(/language=pt$/);
  await expect.poll(() => calls.filter((value) => value === "?language=pt").length).toBe(1);
  await page.goBack(); await expect(page).toHaveURL(/\/workspace\/knowledge$/);
  await expect(language).toContainText(/All languages|Todos os idiomas/);
  await page.goForward(); await expect(language).toContainText(/Portuguese|Português/);
  await page.getByRole("textbox", { name: /Filter documents|Filtrar documentos/ }).fill("Private customer phrase");
  await expect.poll(() => calls.some((value) => value.includes("q=Private") && value.includes("language=pt"))).toBe(true);
  // Forward may reuse a fresh cached query; it must not require a duplicate read.
  expect(calls.filter((value) => value === "?language=pt")).toHaveLength(1);
  expect(page.url()).not.toContain("Private"); expect(page.url()).not.toContain("q=");
  const from = page.getByLabel(/^(Updated from|Atualizado a partir de)$/), to = page.getByLabel(/^(Updated through|Atualizado até)$/);
  await from.fill("2026-11-07"); await to.fill("2026-01-01");
  const before = calls.length;
  await page.getByRole("button", { name: /^(Apply filters|Aplicar filtros)$/ }).click();
  await expect(from).toHaveAttribute("aria-invalid", "true"); await expect(to).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert")).toContainText(/end date|data final/);
  await expect(from).toHaveValue("2026-11-07"); expect(calls).toHaveLength(before);
});

for (const mode of ["answer", "comparison"] as const) {
  test(`FE-11 ${mode} creation failure preserves the draft and chosen mode for retry`, async ({ page, context }) => {
    const fixture = durableFixture(); await fixture.attach(context);
    let attempts = 0;
    await context.route("**/v1/conversations", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      attempts++; return attempts === 1 ? route.fulfill({ status: 503, json: { error: "Synthetic temporary creation failure." } }) : route.fallback();
    });
    await page.goto("/ask");
    if (mode === "comparison") await page.getByRole("checkbox", { name: /Compare two models|Comparar dois modelos/ }).check();
    await composer(page).fill("Keep this private draft"); await composer(page).press("Enter");
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: /^(Try again|Tentar novamente)$/ }).click();
    await expect(composer(page)).toHaveValue("Keep this private draft");
    if (mode === "comparison") await expect(page.getByRole("checkbox", { name: /Compare two models|Comparar dois modelos/ })).toBeChecked();
    await composer(page).press("Enter");
    if (mode === "answer") await expect(messages(page).getByText(response.answer, { exact: true })).toBeVisible();
    else await expect(messages(page).getByText(response.answer, { exact: true })).toHaveCount(2);
    await expect(composer(page)).toHaveValue(""); expect(fixture.submissions).toHaveLength(1);
    expect(page.url()).not.toContain("Keep");
  });
}

test("FE-11 a later draft typed while creation waits is not erased by admission", async ({ page, context }) => {
  const fixture = durableFixture(); await fixture.attach(context);
  let release!: () => void, attempts = 0;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await context.route("**/v1/conversations", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    attempts++; await held; return route.fallback();
  });
  try {
    await page.goto("/ask"); await composer(page).fill("First deliberate question"); await composer(page).press("Enter");
    await expect.poll(() => attempts).toBe(1);
    await composer(page).fill("A follow-up that is still private");
    release(); await expect(messages(page).getByText(response.answer, { exact: true })).toBeVisible();
    await expect(composer(page)).toHaveValue("A follow-up that is still private");
    expect(fixture.submissions).toHaveLength(1); expect(fixture.submissions[0].question).toBe("First deliberate question");
    expect(page.url()).not.toContain("follow-up");
  } finally { release(); }
});

test("FE-11 a failed URL import retains both fields and their accessible error association", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  await context.route("**/v1/admin/uploads/url", (route) => route.fulfill({ status: 502, json: { error: "Synthetic import failure." } }));
  await page.goto("/workspace/knowledge");
  await page.getByRole("button", { name: /^(Add documents|Adicionar documentos)$/ }).click();
  const dialog = page.getByRole("dialog", { name: /^(Add documents|Adicionar documentos)$/ });
  await dialog.getByRole("button", { name: /^(Web page|Página da web)$/ }).click();
  const url = dialog.getByRole("textbox", { name: /Public HTTPS address|Endereço HTTPS público/ });
  const title = dialog.getByRole("textbox", { name: /Title \(optional\)|Título \(opcional\)/ });
  await url.fill("https://example.com/private-draft"); await title.fill("A private title");
  await dialog.getByRole("button", { name: /^(Import page|Importar página)$/ }).click();
  const alert = dialog.getByRole("alert"); await expect(alert).toBeVisible();
  await expect(url).toHaveValue("https://example.com/private-draft"); await expect(title).toHaveValue("A private title");
  expect(await url.getAttribute("aria-describedby")).toContain(await alert.getAttribute("id"));
  expect(page.url()).not.toContain("private-draft"); expect(page.url()).not.toContain("private+title");
});

test("FE-11 workspace switching removes a document-scoped filter and keeps generic metadata", async ({ page, context }) => {
  await workspaceFixture().attach(context);
  const second = "55555555-5555-4555-a555-555555555555", document = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const reads: string[] = [];
  await context.route("**/v1/**", (route) => {
    if (route.request().headers()["x-workspace-id"] !== second) return route.fallback();
    const url = new URL(route.request().url());
    expect(route.request().headers().authorization).toBe("Bearer fixture-workspace-token");
    if (url.pathname.endsWith("/onboarding")) return route.fulfill({ json: { progress: { goal: "knowledge", step: "answer", completed: true } } });
    if (url.pathname === "/v1/admin/documents") { reads.push(url.search); return route.fulfill({ json: { documents: [] } }); }
    if (url.pathname === "/v1/admin/uploads") return route.fulfill({ json: { jobs: [] } });
    return route.fulfill({ status: 404, json: { error: "Unknown secondary fixture read." } });
  });
  await context.route("**/v1/workspaces", (route) => route.fulfill({ json: { workspaces: [
    { tenantId: "11111111-1111-4111-a111-111111111111", tenantName: "Northstar Studio", tenantSlug: "northstar-studio", role: "owner" },
    { tenantId: second, tenantName: "Second library", tenantSlug: "second-library", role: "viewer" }
  ] } }));
  await page.goto(`/workspace/knowledge?documentId=${document}&language=pt&format=pdf`);
  await page.getByRole("button", { name: /^(Workspace|Espaço de trabalho): Northstar Studio/ }).click();
  await page.getByRole("menuitemradio", { name: /^Second library/ }).click();
  await expect(page).toHaveURL(/\/workspace\/knowledge\?language=pt&format=pdf$/);
  await expect(page.getByRole("heading", { name: /^(Documents|Documentos)$/ })).toBeVisible();
  await expect.poll(() => reads.includes("?language=pt&format=pdf")).toBe(true);
  expect(reads.every((search) => !search.includes("documentId"))).toBe(true);
  await expect(page.getByRole("button", { name: /^(Add documents|Adicionar documentos)$/ })).toHaveCount(0);
});
