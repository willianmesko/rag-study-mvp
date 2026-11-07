import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { WorkspaceChatModelPolicy } from "@rag-study/contracts";
import { workspaceFixture } from "./workspace-fixture";

const models = [
  { id: "fast", label: "Fast Model", provider: "openrouter", isDefault: true },
  { id: "balanced", label: "Balanced Model", provider: "openrouter", isDefault: false },
  { id: "careful", label: "Careful Model", provider: "openrouter", isDefault: false }
] as const;
const question = "What is the document retention policy?";
const source = { chunkId: "policy-1", documentId: "policy", source: "Policy", title: "Retention policy", chunk: 0, score: 0.8, excerpt: "Keep records for 90 days." };
const answer = { answer: "Keep records for 90 days.", citedChunkIds: [source.chunkId], sources: [source] };
const scopeHeaders = { authorization: "Bearer fixture-workspace-token", "x-workspace-id": "11111111-1111-4111-a111-111111111111" };

async function attachCatalog(context: BrowserContext) {
  await workspaceFixture().attach(context);
  await context.route("**/v1/qa/models", async (route) => {
    expect(route.request().headers()).toMatchObject(scopeHeaders);
    await route.fulfill({ json: { models, comparisonAvailable: true } });
  });
}

async function selectModel(page: Page, field: RegExp, option: string) {
  await page.getByRole("combobox", { name: field }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("a selected model follows a streamed question across reconnection", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop-en", "The stream transport is shared across viewport profiles.");
  await attachCatalog(context);
  let startCount = 0;
  let runId: string | undefined;
  await context.route("**/v1/qa/stream", async (route) => {
    startCount += 1;
    expect(route.request().headers()).toMatchObject(scopeHeaders);
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ question, modelId: "balanced", topK: 5 });
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
    runId = body.runId;
    await route.fulfill({ contentType: "text/event-stream", body: 'id: 1\nevent: accepted\ndata: {"type":"accepted"}\n\n' });
  });
  await context.route("**/v1/qa/runs/*/events?after=1", async (route) => {
    expect(new URL(route.request().url()).pathname).toBe(`/v1/qa/runs/${runId}/events`);
    expect(route.request().headers()).toMatchObject(scopeHeaders);
    const completed = { type: "completed", response: { ...answer, model: models[1] } };
    await route.fulfill({ contentType: "text/event-stream", body: `id: 2\nevent: completed\ndata: ${JSON.stringify(completed)}\n\n` });
  });

  await page.goto("/ask");
  await selectModel(page, /^Answer model$/, "Balanced Model");
  await page.getByRole("textbox", { name: /What would you like to know/ }).fill(question);
  await page.getByRole("button", { name: "Ask Lumora" }).click();
  await expect(page.getByText("Answer model · Balanced Model", { exact: true })).toBeVisible();
  await expect(page.getByText(answer.answer, { exact: true })).toBeVisible();
  expect(startCount).toBe(1);
});

test("a comparison uses distinct models and displays a successful and failed run", async ({ page, context }, info) => {
  await attachCatalog(context);
  await context.route("**/v1/qa/compare", async (route) => {
    expect(route.request().headers()).toMatchObject(scopeHeaders);
    expect(route.request().postDataJSON()).toEqual({ question, topK: 5, modelIds: ["balanced", "careful"] });
    await route.fulfill({ json: { results: [
      { model: models[1], response: answer, error: null, latencyMs: 1200, estimatedCostUsd: 0.00007 },
      { model: models[2], response: null, error: "generation_failed", latencyMs: 900, estimatedCostUsd: 0.00004 }
    ] } });
  });
  await page.goto("/ask");
  await selectModel(page, /^Answer model$|^Modelo de resposta$/, "Balanced Model");
  const compareMode = page.getByRole("checkbox", { name: /Compare two models|Comparar dois modelos/ });
  await compareMode.click();
  await expect(compareMode).toBeChecked();
  await page.getByRole("combobox", { name: /Second model|Segundo modelo/ }).click();
  await expect(page.getByRole("option", { name: "Balanced Model", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "Careful Model", exact: true }).click();
  await page.getByRole("textbox", { name: /What would you like to know|O que você gostaria de saber/ }).fill(question);
  await page.getByRole("button", { name: /Compare answers|Comparar respostas/ }).click();

  const first = page.getByRole("article", { name: "Balanced Model" });
  const second = page.getByRole("article", { name: "Careful Model" });
  await expect(first.getByText(answer.answer, { exact: true })).toBeVisible();
  await expect(first.getByText(/0[.,]00007/)).toBeVisible();
  await expect(second.getByText(/could not finish|não conseguiu concluir/)).toBeVisible();
  await first.getByText(/Read cited passages|Ler trechos citados/).click();
  await expect(first.getByText(/Validated citations|Citações validadas/, { exact: false })).toBeVisible();
  const a = (await first.boundingBox())!;
  const b = (await second.boundingBox())!;
  if (info.project.name === "mobile-pt") expect(b.y).toBeGreaterThan(a.y);
  else expect(b.x).toBeGreaterThan(a.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, elements: nodes.map(({ target }) => target) }))).toEqual([]);
});

test("the public demo keeps its default model and existing stream", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop-en", "The public request contract is shared across viewport profiles.");
  let catalogRequests = 0;
  await context.route("**/v1/qa/models", async (route) => {
    catalogRequests += 1;
    await route.fulfill({ status: 401, json: { error: "Missing session." } });
  });
  await context.route("**/health", (route) => route.fulfill({ json: { status: "ok" } }));
  await context.route("**/v1/qa/stream", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ question, topK: 5 });
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({ contentType: "text/event-stream", body: `event: completed\ndata: ${JSON.stringify(answer)}\n\n` });
  });
  await page.goto("/demo/ask");
  await expect(page.getByRole("combobox", { name: "Answer model" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Compare two models" })).toHaveCount(0);
  await page.getByRole("textbox", { name: /What would you like to know/ }).fill(question);
  await page.getByRole("button", { name: "Ask Lumora" }).click();
  await expect(page.getByText(answer.answer, { exact: true })).toBeVisible();
  expect(catalogRequests).toBe(0);
});

test("owners set a workspace model policy and Ask reports automatic fallback", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop-en", "The policy form and automatic routing share the same transport across profiles.");
  await workspaceFixture().attach(context);
  let policy: WorkspaceChatModelPolicy = { allowedModelIds: ["fast", "balanced", "careful"], defaultModelId: "fast", auto: null };
  await context.route("**/v1/admin/chat-model-policy", async (route) => {
    expect(route.request().headers()).toMatchObject(scopeHeaders);
    if (route.request().method() === "PATCH") policy = route.request().postDataJSON();
    await route.fulfill({ json: { policy, availableModels: models } });
  });
  await context.route("**/v1/qa/models", (route) => route.fulfill({ json: {
    models: models.filter(({ id }) => policy.allowedModelIds.includes(id)), comparisonAvailable: policy.allowedModelIds.length >= 2,
    autoAvailable: policy.auto !== null
  } }));
  await context.route("**/v1/qa/stream", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ question, modelId: "auto" });
    const completed = { type: "completed", response: { ...answer, model: models[1], routing: {
      mode: "auto", reason: "simple", attemptedModelIds: ["fast", "balanced"], usedFallback: true
    }, usage: { source: "observed", inputTokens: 99, outputTokens: 12, latencyMs: 83, estimatedCostUsd: 0.0001,
      observedCostUsd: 0.00009, promptVersion: "grounded-v1", citationCount: 1, safetyOutcome: "validated" } } };
    await route.fulfill({ contentType: "text/event-stream", body: `id: 1\nevent: completed\ndata: ${JSON.stringify(completed)}\n\n` });
  });

  await page.goto("/workspace/settings");
  await expect(page.getByRole("heading", { name: "Chat model policy" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Careful Model" }).uncheck();
  await page.getByRole("checkbox", { name: "Allow automatic routing" }).check();
  await selectModel(page, /^Complex questions$/, "Balanced Model");
  await selectModel(page, /^Fallback 1$/, "Balanced Model");
  await page.getByRole("button", { name: "Save model policy" }).click();
  await expect(page.getByText("Model policy saved for this workspace.")).toBeVisible();
  expect(policy).toEqual({ allowedModelIds: ["fast", "balanced"], defaultModelId: "fast", auto: {
    simpleModelId: "fast", complexModelId: "balanced", fallbackModelIds: ["balanced"]
  } });

  await page.goto("/ask");
  await selectModel(page, /^Answer model$/, "Automatic");
  await page.getByRole("textbox", { name: /What would you like to know/ }).fill(question);
  await page.getByRole("button", { name: "Ask Lumora" }).click();
  await expect(page.getByText("Answer model · Balanced Model", { exact: true })).toBeVisible();
  await expect(page.getByText(/approved fallback produced this answer/)).toBeVisible();
  await page.getByText("Run details", { exact: true }).click();
  await expect(page.getByText(/99 \/ 12 reported input\/output tokens/)).toBeVisible();
});
