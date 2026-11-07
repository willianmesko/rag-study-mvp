import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { workspaceFixture } from "./workspace-fixture";

const firstQuestion = "What is the policy for access requests?";
const followUp = "Who approves them?";
const freshQuestion = "What is the retention period?";
const firstAnswer = "Employees submit access requests through the internal portal.";
const followUpAnswer = "The employee's manager approves each request.";
const freshAnswer = "Records are kept for 90 days.";
const scopeHeaders = {
  authorization: "Bearer fixture-workspace-token",
  "x-workspace-id": "11111111-1111-4111-a111-111111111111"
};
const passage = {
  chunkId: "access-1", documentId: "access", source: "Policy library", title: "Internal access policy",
  chunk: 0, score: 0.8, excerpt: "Access requests require approval from the employee's manager."
};

test("a workspace chat keeps its messages and resets the context for a new conversation", async ({ page, context }, info) => {
  await workspaceFixture().attach(context);
  await context.route("**/v1/qa/models", (route) => route.fulfill({ json: {
    models: [{ id: "default", label: "Workspace model", provider: "openrouter", isDefault: true }],
    comparisonAvailable: false
  } }));
  const turns = [
    { question: firstQuestion, answer: firstAnswer },
    { question: followUp, answer: followUpAnswer, previousQuestions: [firstQuestion] },
    { question: freshQuestion, answer: freshAnswer }
  ];
  let requests = 0;
  await context.route("**/v1/qa/stream", async (route) => {
    const turn = turns[requests++];
    expect(route.request().headers()).toMatchObject(scopeHeaders);
    const body = route.request().postDataJSON();
    expect(body.question).toBe(turn.question);
    expect(body.previousQuestions).toEqual(turn.previousQuestions);
    const event = { type: "completed", response: { answer: turn.answer, citedChunkIds: [passage.chunkId], sources: [passage] } };
    await route.fulfill({ contentType: "text/event-stream", body: `id: 1\nevent: completed\ndata: ${JSON.stringify(event)}\n\n` });
  });

  await page.goto("/ask");
  const composer = page.getByRole("textbox", { name: /What would you like to know|O que você gostaria de saber/ });
  const messages = page.getByRole("region", { name: /Conversation messages|Mensagens da conversa/ });
  const send = page.getByRole("button", { name: /^(Send message|Enviar mensagem)$/ });
  await expect(send).toBeDisabled();
  if (info.project.name === "mobile-pt") await expect(composer).toBeInViewport({ ratio: 1 });
  await composer.fill(firstQuestion);
  await composer.press("Shift+Enter");
  await expect(composer).toHaveValue(`${firstQuestion}\n`);
  expect(requests).toBe(0);
  await composer.press("Enter");
  await expect(messages.getByText(firstAnswer, { exact: true })).toBeVisible();
  await expect(composer).toBeEmpty();

  const navigation = page.getByRole("navigation", { name: /Main navigation|Navegação principal/ });
  await navigation.getByRole("button", { name: /^(Search|Buscar)$/ }).click();
  await expect(page).toHaveURL(/\/search$/);
  await navigation.getByRole("button", { name: /^(Ask|Chat|Perguntar|Conversa)$/ }).click();
  await expect(messages.getByText(firstAnswer, { exact: true })).toBeVisible();

  await composer.fill(followUp);
  await composer.press("Enter");
  await expect(messages.getByText(followUpAnswer, { exact: true })).toBeVisible();
  const orderedText = [firstQuestion, firstAnswer, followUp, followUpAnswer]
    .map((text) => messages.getByText(text, { exact: true }));
  await expect(orderedText.reduce((all, message) => all.or(message))).toHaveText([firstQuestion, firstAnswer, followUp, followUpAnswer]);
  await messages.getByText(/Read sources and passages|Ler fontes e trechos/).last().click();
  await expect(messages.getByText(passage.title, { exact: true }).filter({ visible: true }).first()).toBeVisible();

  await page.getByRole("button", { name: /^(New chat|Nova conversa)$/ }).click();
  await expect(messages.getByText(firstQuestion, { exact: true })).toHaveCount(0);
  await composer.fill(freshQuestion);
  await send.click();
  await expect(messages.getByText(freshAnswer, { exact: true })).toBeVisible();
  expect(requests).toBe(3);

  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.map(({ id, nodes }) => ({ id, elements: nodes.map(({ target }) => target) }))).toEqual([]);
});

test("the JSON fallback carries the same recent user context", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop-en", "The request fallback is shared across viewport profiles.");
  await workspaceFixture().attach(context);
  let starts = 0;
  await context.route("**/v1/qa/stream", async (route) => {
    if (++starts === 2) return route.fulfill({ status: 404, json: { error: "Stream is unavailable." } });
    const event = { type: "completed", response: { answer: firstAnswer, sources: [] } };
    return route.fulfill({ contentType: "text/event-stream", body: `id: 1\nevent: completed\ndata: ${JSON.stringify(event)}\n\n` });
  });
  await context.route("**/v1/qa", async (route) => {
    expect(route.request().headers()).toMatchObject(scopeHeaders);
    expect(route.request().postDataJSON()).toEqual({ question: followUp, topK: 5, previousQuestions: [firstQuestion] });
    await route.fulfill({ json: { answer: followUpAnswer, sources: [] } });
  });

  await page.goto("/ask");
  const composer = page.getByRole("textbox", { name: "What would you like to know?" });
  const messages = page.getByRole("region", { name: "Conversation messages" });
  await composer.fill(firstQuestion);
  await composer.press("Enter");
  await expect(messages.getByText(firstAnswer, { exact: true })).toBeVisible();
  await composer.fill(followUp);
  await composer.press("Enter");
  await expect(messages.getByText(followUpAnswer, { exact: true })).toBeVisible();
  await expect(messages.getByText(firstAnswer, { exact: true })).toBeVisible();
  expect(starts).toBe(2);
});

test("a reloaded chat displays a recovered reply in the conversation", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop-en", "Reloading a saved run uses the same browser storage on each viewport.");
  await workspaceFixture().attach(context);
  const runId = "55555555-5555-4555-a555-555555555555";
  const storageKey = "lumora-chat-run:22222222-2222-4222-a222-222222222222:11111111-1111-4111-a111-111111111111";
  await context.addInitScript(({ key, id }) => {
    if (location.hostname === "127.0.0.1" && !sessionStorage.getItem("fixture-run-initialized")) {
      sessionStorage.setItem("fixture-run-initialized", "yes");
      sessionStorage.setItem(key, id);
    }
  }, { key: storageKey, id: runId });
  await context.route(`**/v1/qa/runs/${runId}/events?after=0`, (route) => {
    expect(route.request().headers()).toMatchObject(scopeHeaders);
    const event = { type: "completed", response: { answer: firstAnswer, sources: [] } };
    return route.fulfill({ contentType: "text/event-stream", body: `id: 1\nevent: completed\ndata: ${JSON.stringify(event)}\n\n` });
  });

  await page.goto("/ask");
  const messages = page.getByRole("region", { name: "Conversation messages" });
  await expect(messages.getByText(firstAnswer, { exact: true })).toBeVisible();
  await expect(messages.getByText("You", { exact: true })).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storageKey)).toBeNull();
});

test("desktop chat uses the available column and viewport height", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop-en", "Large viewport geometry uses the desktop profile.");
  await workspaceFixture().attach(context);
  await page.goto("/ask");
  const chat = page.getByRole("region", { name: "Chat with Milo", exact: true });
  await expect(chat).toBeVisible();
  for (const width of [1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 950 });
    const bounds = await chat.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      available: element.parentElement!.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      bottom: element.getBoundingClientRect().bottom
    }));
    expect(bounds.width).toBeCloseTo(bounds.available, 0);
    expect(bounds.height).toBeGreaterThan(950 * 0.82);
    expect(bounds.bottom).toBeLessThanOrEqual(950);
  }
});
