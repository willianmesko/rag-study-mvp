import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";
import type { DemoSourceState } from "@rag-study/contracts";
import { demoLibraries } from "../../apps/api/src/application/demo-libraries/catalog";
import { workspaceFixture } from "./workspace-fixture";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const date = "2026-11-06T12:00:00.000Z";
const id = (index: number) => `77777777-7777-4777-a777-${String(index).padStart(12, "0")}`;

async function discoveryFixture(context: BrowserContext, locale: "en" | "pt-BR", { viewer = false, failOnceAt = 0 } = {}) {
  await workspaceFixture().attach(context);
  if (viewer) await context.route("**/v1/workspaces", (route) => route.fulfill({ json: { workspaces: [{ tenantId: workspaceId, tenantName: "Northstar Studio", tenantSlug: "northstar-studio", role: "viewer" }] } }));
  const libraries = demoLibraries(locale);
  const allDocuments = libraries.flatMap(({ documents }) => documents);
  const sources = new Map<string, DemoSourceState>();
  const posts: string[] = [];
  let accepted = 0;
  let answerRequests = 0;
  function verifyScope(headers: Record<string, string>) {
    expect(headers).toMatchObject({ authorization: "Bearer fixture-workspace-token", "x-workspace-id": workspaceId });
  }
  function catalogStates() {
    return allDocuments.map(({ source }) => sources.get(source) ?? { source, state: "missing" as const, documentId: null, jobId: null });
  }
  function completeAccepted() {
    for (const [source, state] of sources) sources.set(source, { ...state, state: "ready", documentId: id(allDocuments.findIndex((document) => document.source === source) + 1) });
  }
  function readyDocuments() {
    return allDocuments.filter(({ source }) => sources.get(source)?.state === "ready").map((document) => ({
      id: sources.get(document.source)!.documentId, source: document.source, title: document.title, chunkCount: 3,
      hasOriginal: false, format: document.format, language: document.language, sectionCount: 3, createdAt: date, updatedAt: date
    }));
  }
  await context.route("**/v1/demo-libraries**", (route) => {
    verifyScope(route.request().headers());
    expect(new URL(route.request().url()).searchParams.get("locale")).toBe(locale);
    return route.fulfill({ json: { libraries, states: catalogStates() } });
  });
  await context.route("**/v1/admin/demo-libraries/*/documents/*", (route) => {
    const request = route.request(); verifyScope(request.headers());
    expect(request.postDataJSON()).toEqual({ locale });
    const parts = new URL(request.url()).pathname.split("/");
    const library = libraries.find(({ id }) => id === parts[4])!;
    const document = library.documents.find(({ id }) => id === parts[6])!;
    posts.push(document.source);
    if (failOnceAt && posts.length === failOnceAt) return route.fulfill({ status: 503, json: { error: "Temporary fixture failure." } });
    const existing = sources.get(document.source);
    if (existing) return route.fulfill({ json: { created: false, state: existing } });
    const state = { source: document.source, state: "queued" as const, documentId: null, jobId: id(100 + ++accepted) };
    sources.set(document.source, state);
    return route.fulfill({ status: 202, json: { created: true, state } });
  });
  await context.route("**/v1/admin/documents**", (route) => {
    verifyScope(route.request().headers());
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/chunks")) return route.fulfill({ json: { chunks: [{ id: id(500), ordinal: 0, content: "A reviewed document passage.", createdAt: date, security: { promptInjectionRisk: "low", signals: [] } }] } });
    const documents = readyDocuments();
    return route.fulfill({ json: { documents: url.searchParams.has("documentId") ? documents.filter(({ id }) => id === url.searchParams.get("documentId")) : documents } });
  });
  const run = {
    id: id(900), tenantId: workspaceId, datasetName: "RAG fundamentals retrieval", datasetVersion: "1.0", commitSha: "b16d396",
    embeddingProvider: "fixture", embeddingModel: "fixture", chatProvider: "openrouter", chatModel: "openai/gpt-4o-mini", totalCases: 4,
    hitRate: 0, meanReciprocalRank: 0, faithfulness: 1, contextPrecision: 0, injectionPassRate: 1, passed: false, durationMs: 500,
    createdAt: date, failureDetails: { quality: { contextPrecision: { method: "reviewed-passage-ap", version: "1.0", scoredCases: 4 },
      faithfulness: { method: "public-claim-evidence-judge", version: "1.0", status: "completed", judgeModel: "fixture-judge", scoredCases: 4, totalCases: 4,
        calibration: { version: "2.0", expectedClaims: 6, matchedClaims: 6, agreement: 1, falsePositiveRate: 0, falseNegativeRate: 0 } } } }
  };
  await context.route("**/v1/admin/evaluations?*", (route) => {
    const reference = catalogStates().find(({ source }) => source === "golden/rag-fundamentals")!;
    return route.fulfill({ json: { runs: [run], faithfulnessEnabled: true, reference: { ...reference, ready: reference.state === "ready" } } });
  });
  await context.route("**/v1/qa/models", (route) => route.fulfill({ json: {
    models: [{ id: "default", label: "Workspace model", provider: "openrouter", isDefault: true }], comparisonAvailable: false,
    promptComparisonAvailable: true, promptVariants: [{ id: "balanced", version: "grounded-v1" }, { id: "concise", version: "grounded-concise-v1" }, { id: "explanatory", version: "grounded-explanatory-v1" }]
  } }));
  await context.route("**/v1/qa/stream", (route) => {
    verifyScope(route.request().headers()); answerRequests++;
    const question = route.request().postDataJSON().question;
    const supporting = libraries.flatMap(({ questions }) => questions).find((item) => item.question === question)!.expectedSources[0]!;
    const document = allDocuments.find(({ source }) => source === supporting)!;
    const event = { type: "completed", response: { answer: locale === "en" ? "Northstar procedures are reviewed every 90 days." : "Os procedimentos Northstar são revisados a cada 90 dias.", citedChunkIds: [id(501)], sources: [{ chunkId: id(501), documentId: sources.get(supporting)!.documentId, source: supporting, title: document.title, chunk: 0, score: 0.8, excerpt: document.preview ?? document.content }] } };
    return route.fulfill({ contentType: "text/event-stream", body: `id: 1\nevent: completed\ndata: ${JSON.stringify(event)}\n\n` });
  });
  return { libraries, sources, posts, completeAccepted, accepted: () => accepted, answerRequests: () => answerRequests };
}

test("demo sources import explicitly, show preparation, open documents, and suggest a grounded question", async ({ page, context }, info) => {
  const locale = info.project.name === "mobile-pt" ? "pt-BR" : "en";
  const fixture = await discoveryFixture(context, locale);
  const library = fixture.libraries[0]!;
  await page.goto("/workspace/knowledge");
  await page.getByRole("button", { name: /^(Demo libraries|Bibliotecas de exemplo)$/ }).click();
  const dialog = page.getByRole("dialog", { name: /^(Demonstration libraries|Bibliotecas de demonstração)$/ });
  const choose = dialog.getByRole("combobox", { name: /^(Library|Biblioteca)$/ });
  await choose.click();
  const menu = page.getByRole("listbox");
  expect(await menu.evaluate((element) => Boolean(element.closest("dialog[open]")))).toBe(true);
  await page.getByRole("option", { name: new RegExp(`^${fixture.libraries[1]!.title}`) }).click();
  await choose.click();
  await page.getByRole("option", { name: new RegExp(`^${library.title}`) }).click();
  expect(fixture.posts).toHaveLength(0);
  const ask = dialog.getByRole("button", { name: /^(Ask this question|Fazer esta pergunta)$/ }).first();
  await expect(ask).toBeDisabled();
  await dialog.getByRole("button", { name: /Add library to this workspace|Adicionar biblioteca a este espaço/ }).click();
  await expect.poll(fixture.accepted).toBe(5);
  await expect(dialog.getByText(/5\/5 files checked|5\/5 arquivos conferidos/)).toBeVisible();
  await expect(ask).toBeDisabled();
  fixture.completeAccepted();
  await expect(dialog.getByRole("button", { name: /^(Library added|Biblioteca adicionada)$/ })).toBeDisabled({ timeout: 8_000 });
  await expect(ask).toBeEnabled();
  await expect(page.getByText(/^5 (shown|exibidos)$/)).toBeVisible({ timeout: 8_000 });
  if (process.platform === "linux" && process.arch === "x64" && info.project.name === "desktop-en") {
    await dialog.evaluate((element) => { element.scrollTop = 0; });
    await expect(page).toHaveScreenshot("demo-library.png", { fullPage: true });
  }
  await dialog.getByRole("button", { name: /Open added document|Abrir documento adicionado/ }).first().click();
  const document = page.getByRole("dialog", { name: library.documents[0]!.title, exact: true });
  await expect(document).toBeVisible();
  await expect(document.getByText(library.documents[0]!.source, { exact: true })).toBeVisible();
  await document.getByRole("button", { name: /^(Close|Fechar)$/ }).click();
  await page.getByRole("button", { name: /^(Demo libraries|Bibliotecas de exemplo)$/ }).click();
  await dialog.getByRole("button", { name: /^(Ask this question|Fazer esta pergunta)$/ }).first().click();
  await expect(page).toHaveURL(/\/ask$/);
  const composer = page.getByRole("textbox", { name: /What would you like to know|O que você gostaria de saber/ });
  await expect(composer).toHaveValue(library.questions[0]!.question);
  expect(fixture.answerRequests()).toBe(0);
  await page.getByRole("button", { name: /^(Send message|Enviar mensagem)$/ }).click();
  await expect(page.getByText(/Northstar procedures are reviewed every 90 days|Os procedimentos Northstar são revisados a cada 90 dias/)).toBeVisible();
  expect(fixture.answerRequests()).toBe(1);
});

test("a partial library import can resume without duplicating accepted files", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop-en", "Replay and failure handling use the same request flow across profiles.");
  const fixture = await discoveryFixture(context, "en", { failOnceAt: 3 });
  await page.goto("/workspace/knowledge");
  await page.getByRole("button", { name: "Demo libraries", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Demonstration libraries", exact: true });
  const add = dialog.getByRole("button", { name: "Add library to this workspace", exact: true });
  await add.click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(fixture.accepted()).toBe(2);
  await add.click();
  await expect.poll(fixture.accepted).toBe(5);
  expect(fixture.posts.length).toBe(8);
  fixture.completeAccepted();
  await expect(dialog.getByRole("button", { name: "Library added", exact: true })).toBeDisabled({ timeout: 8_000 });
});

test("viewers preview libraries without an import action", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop-en", "Read-only authorization also has API coverage.");
  const fixture = await discoveryFixture(context, "en", { viewer: true });
  await page.goto("/workspace/knowledge");
  await page.getByRole("button", { name: "Demo libraries", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Demonstration libraries", exact: true });
  await expect(dialog.getByText("An owner or editor can add these files.", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add library to this workspace" })).toHaveCount(0);
  await dialog.getByText("Preview source", { exact: true }).first().click();
  await expect(dialog.getByText(/Fictional demonstration material/).first()).toBeVisible();
  expect(fixture.posts).toHaveLength(0);
});

test("reference setup distinguishes failed workspace retrieval from public faithfulness", async ({ page, context }, info) => {
  const locale = info.project.name === "mobile-pt" ? "pt-BR" : "en";
  const fixture = await discoveryFixture(context, locale);
  await page.goto("/workspace/evaluations");
  const run = page.getByRole("button", { name: /^(Run evaluation|Executar avaliação)$/ });
  await expect(run).toBeDisabled();
  await expect(page.getByText(/requires the RAG Fundamentals reference document|exige o documento de referência RAG Fundamentals/)).toBeVisible();
  await expect(page.getByText(/4\/4 cases scored|4\/4 casos avaliados/)).toBeVisible();
  await expect(page.getByText(/None of this run’s retrieval questions|Nenhuma pergunta de busca desta execução/)).toBeVisible();
  await page.getByRole("button", { name: /Prepare reference benchmark|Preparar benchmark de referência/ }).click();
  const dialog = page.getByRole("dialog", { name: /Demonstration libraries|Bibliotecas de demonstração/ });
  await expect(dialog.getByRole("combobox", { name: /^(Library|Biblioteca)$/ })).toContainText(/RAG reference benchmark|Benchmark de referência RAG/);
  await dialog.getByRole("button", { name: /Add library to this workspace|Adicionar biblioteca a este espaço/ }).click();
  await expect.poll(fixture.accepted).toBe(1);
  fixture.completeAccepted();
  await expect(dialog.getByRole("button", { name: /^(Library added|Biblioteca adicionada)$/ })).toBeDisabled({ timeout: 8_000 });
  await dialog.getByRole("button", { name: /^(Close|Fechar)$/ }).click();
  await expect(run).toBeEnabled({ timeout: 8_000 });
  await expect(page.getByText(/None of this run’s retrieval questions|Nenhuma pergunta de busca desta execução/)).toBeVisible();
});

test("one allowed model compares two approved prompts and exports safe measurement fields", async ({ page, context }, info) => {
  const locale = info.project.name === "mobile-pt" ? "pt-BR" : "en";
  await discoveryFixture(context, locale);
  let requests = 0;
  await context.route("**/v1/qa/compare", async (route) => {
    expect(route.request().headers()).toMatchObject({ authorization: "Bearer fixture-workspace-token", "x-workspace-id": workspaceId });
    expect(route.request().postDataJSON()).toEqual({ question: "Who reviews the handbook?", topK: 5, modelIds: ["default", "default"], promptVariantIds: ["concise", "explanatory"] });
    requests++;
    const model = { id: "default", label: "Workspace model", provider: "openrouter", isDefault: true };
    await route.fulfill({ json: { results: ["concise", "explanatory"].map((variant, index) => ({ model, providerModel: "fixture/model", prompt: { id: variant, version: `grounded-${variant}-v1` }, error: null, latencyMs: 100, estimatedCostUsd: 0.0001,
      response: { answer: index ? "Declined." : "The Operations Lead reviews it.", sources: [], citedChunkIds: [], structuredOutput: true, ...(index ? { refusalReason: "Operations Lead private note from an untrusted_document" } : {}),
        usage: { source: "observed", inputTokens: 100, outputTokens: 20, latencyMs: 100, estimatedCostUsd: 0.0001, promptVersion: `grounded-${variant}-v1`, citationCount: 0, safetyOutcome: index ? "refused" : "validated" } }
    })) } });
  });
  await page.goto("/ask");
  await page.getByRole("checkbox", { name: /^(Compare prompts|Comparar prompts)$/ }).check();
  await page.getByRole("combobox", { name: /First prompt|Primeiro prompt/ }).click();
  await page.getByRole("option", { name: /^(Concise|Conciso)$/ }).click();
  await page.getByRole("combobox", { name: /Second prompt|Segundo prompt/ }).click();
  await page.getByRole("option", { name: /^(Explanatory|Explicativo)$/ }).click();
  await page.getByRole("textbox", { name: /What would you like to know|O que você gostaria de saber/ }).fill("Who reviews the handbook?");
  await page.getByRole("button", { name: /^(Compare answers|Comparar respostas)$/ }).click();
  await expect(page.getByRole("heading", { name: /^(Prompt comparison|Comparação de prompts)$/ })).toBeVisible();
  await expect(page.getByText(/Format and source IDs checked|Formato e fontes conferidos/)).toBeVisible();
  await expect(page.getByText(/Answer declined by validation|Resposta recusada pela validação/)).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export comparison metrics|Exportar métricas da comparação/ }).click();
  const downloadPath = await (await downloaded).path();
  const report = JSON.parse(await readFile(downloadPath, "utf8"));
  assert.equal(report.mode, "prompts");
  assert.deepEqual(report.results.map((result: { prompt: { id: string } }) => result.prompt.id), ["concise", "explanatory"]);
  assert.equal(report.results[1].refusalReason, "model_refused");
  expect(JSON.stringify(report)).not.toMatch(/Who reviews|Operations Lead|untrusted_document/);
  expect(requests).toBe(1);
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }))).toEqual([]);
  await page.getByRole("region", { name: /Conversation messages|Mensagens da conversa/ }).evaluate((element) => { element.scrollTop = 0; });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (process.platform === "linux" && process.arch === "x64") await expect(page).toHaveScreenshot("prompt-comparison.png", { fullPage: true });
});

test("advanced document filters are sent to the workspace API and invalid dates stay local", async ({ page, context }, info) => {
  await workspaceFixture().attach(context);
  const documents = [
    { id: id(1), source: "policies/handbook", title: "Portuguese handbook", language: "pt", format: "pdf", createdAt: date, updatedAt: date, chunkCount: 2 },
    { id: id(2), source: "guides/start", title: "English guide", language: "en", format: "html", createdAt: date, updatedAt: date, chunkCount: 2 }
  ];
  const requests: URLSearchParams[] = [];
  await context.route("**/v1/admin/documents**", (route) => {
    expect(route.request().headers()["x-workspace-id"]).toBe(workspaceId);
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    return route.fulfill({ json: { documents: params.has("format") ? [documents[0]] : documents } });
  });
  await page.goto("/workspace/knowledge");
  for (const name of [/^(Demo libraries|Bibliotecas de exemplo)$/, /^(Add documents|Adicionar documentos)$/]) {
    const button = page.getByRole("button", { name });
    await expect(button).toBeVisible();
    const bounds = await button.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await page.getByText(/^(Advanced filters|Filtros avançados)$/).click();
  await page.getByRole("combobox", { name: /^(Language|Idioma)$/ }).click();
  await page.getByRole("option", { name: /^(Portuguese|Português)$/ }).click();
  await page.getByRole("combobox", { name: /^(File type|Tipo de arquivo)$/ }).click();
  await page.getByRole("option", { name: "PDF", exact: true }).click();
  await page.getByRole("textbox", { name: /Source contains|A fonte contém/ }).fill("policies/");
  await page.getByLabel(/Updated from|Atualizado a partir de/).fill("2026-01-01");
  await page.getByLabel(/Updated through|Atualizado até/).fill("2026-01-31");
  await page.getByRole("button", { name: /Apply filters|Aplicar filtros/ }).click();
  await expect(page.getByRole("button", { name: /^Portuguese handbook/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^English guide/ })).toHaveCount(0);
  // Initial/placeholder rows can briefly match while the filtered query starts.
  await expect.poll(() => {
    const filtered = requests.find((params) => params.has("format"));
    return filtered ? Object.fromEntries(filtered) : null;
  }).toEqual({ source: "policies/", language: "pt", format: "pdf", from: "2026-01-01", to: "2026-01-31" });
  if (process.platform === "linux" && process.arch === "x64") await expect(page).toHaveScreenshot("document-filters.png", { fullPage: true });
  await page.getByLabel(/Updated from|Atualizado a partir de/).fill("2026-02-01");
  await page.getByRole("button", { name: /Apply filters|Aplicar filtros/ }).click();
  await expect(page.getByRole("alert")).toContainText(/end date|data final/);
  expect(requests.some((params) => params.get("from") === "2026-02-01")).toBe(false);
  await page.getByRole("button", { name: /Clear filters|Limpar filtros/ }).click();
  await expect(page.getByRole("button", { name: /^English guide/ })).toBeVisible();
  const size = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(size.content).toBeLessThanOrEqual(size.viewport);
});
