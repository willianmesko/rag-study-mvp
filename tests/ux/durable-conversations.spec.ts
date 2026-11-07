import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type {
  ConversationSummary,
  ConversationTurn,
  QuestionResponse,
} from "@rag-study/contracts";
import { workspaceFixture } from "./workspace-fixture";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const question = "How do I request access?";
const response: QuestionResponse = {
  answer: "Submit an access request through the team portal.",
  sources: [
    {
      chunkId: "55555555-5555-4555-a555-555555555555",
      documentId: "66666666-6666-4666-a666-666666666666",
      source: "team-handbook.md",
      title: "Team handbook",
      chunk: 0,
      score: 0.88,
      excerpt: "Submit an access request through the team portal.",
    },
  ],
  citedChunkIds: ["55555555-5555-4555-a555-555555555555"],
  structuredOutput: true,
  model: {
    id: "default",
    label: "Workspace model",
    provider: "openrouter",
    isDefault: true,
  },
  providerModel: "fixture/chat",
  usage: {
    source: "observed",
    inputTokens: 84,
    outputTokens: 12,
    latencyMs: 120,
    estimatedCostUsd: 0.00002,
    promptVersion: "grounded-v1",
    citationCount: 1,
    safetyOutcome: "validated",
  },
};
const models = [
  response.model!,
  {
    ...response.model!,
    id: "careful",
    label: "Careful model",
    isDefault: false,
  },
];
const date = "2026-11-07T12:00:00.000Z";

/** A product API fixture shared by independent browser contexts, never browser storage. */
function durableFixture(
  progress?: import("@rag-study/contracts").WorkspaceOnboardingProgress,
) {
  const records = new Map<
    string,
    { summary: ConversationSummary; turns: ConversationTurn[] }
  >();
  const submissions: Record<string, unknown>[] = [];
  let hold = false,
    listFailure = false;
  function create(id = randomUUID(), title: string | null = null) {
    const row = {
      summary: {
        id,
        title,
        turnCount: 0,
        createdAt: date,
        updatedAt: date,
        expiresAt: "2027-02-05T12:00:00.000Z",
      },
      turns: [] as ConversationTurn[],
    };
    records.set(id, row);
    return row;
  }
  function turn(
    id: string,
    text: string,
    runId = randomUUID(),
    mode: "answer" | "comparison" = "answer",
  ) {
    const row = records.get(id)!;
    const item: ConversationTurn = {
      runId,
      userMessageId: randomUUID(),
      assistantMessageId: randomUUID(),
      conversationId: id,
      sequence: row.turns.length + 1,
      mode: "answer",
      question: text,
      status: "completed",
      input: { question: text, topK: 5 },
      answer: response,
      comparison: null,
      feedback: null,
      failureCode: null,
      createdAt: date,
      completedAt: date,
    };
    if (mode === "comparison") {
      Object.assign(item, {
        mode,
        input: { question: text, topK: 5, modelIds: ["default", "careful"] },
        answer: null,
        comparison: {
          results: models.map((model) => ({
            model,
            providerModel: "fixture/chat",
            prompt: { id: "balanced", version: "grounded-v1" },
            response: { ...response, model },
            error: null,
            latencyMs: 120,
            estimatedCostUsd: 0.00002,
          })),
        },
      });
    }
    row.turns.push(item);
    row.summary.turnCount++;
    row.summary.title ??= text;
    return item;
  }
  async function attach(context: BrowserContext) {
    await workspaceFixture(progress).attach(context);
    await context.route("**/health", (route) =>
      route.fulfill({
        json: { status: "ok", capabilities: { durableConversations: true } },
      }),
    );
    await context.route("**/v1/qa/models", (route) =>
      route.fulfill({ json: { models, comparisonAvailable: true } }),
    );
    await context.route("**/v1/conversations**", async (route) => {
      expect(route.request().headers()).toMatchObject({
        authorization: "Bearer fixture-workspace-token",
        "x-workspace-id": workspaceId,
      });
      const { pathname, searchParams } = new URL(route.request().url()),
        method = route.request().method();
      const parts = pathname.split("/").filter(Boolean),
        id = parts[2];
      if (!id) {
        if (method === "POST") {
          const input = route.request().postDataJSON();
          const row = records.get(input.id) ?? create(input.id, input.title);
          return route.fulfill({
            status: 201,
            json: { conversation: row.summary },
          });
        }
        if (listFailure)
          return route.fulfill({
            status: 503,
            json: { error: "History is temporarily unavailable." },
          });
        return route.fulfill({
          json: {
            conversations: [...records.values()]
              .map(({ summary }) => summary)
              .reverse(),
            nextCursor: null,
          },
        });
      }
      const row = records.get(id);
      if (!row)
        return route.fulfill({
          status: 404,
          json: { error: "Conversation not available." },
        });
      if (parts[3] === "messages" && parts[5] === "feedback") {
        const item = row.turns.find(
          ({ assistantMessageId }) => assistantMessageId === parts[4],
        )!;
        item.feedback = route.request().postDataJSON().value;
        return route.fulfill({ status: 204 });
      }
      if (parts[3] === "messages") {
        const before = Number(searchParams.get("before") ?? 501),
          items = row.turns.filter(({ sequence }) => sequence < before),
          page = items.slice(-25);
        return route.fulfill({
          json: {
            conversation: row.summary,
            turns: page,
            nextBefore: items.length > 25 ? page[0].sequence : null,
          },
        });
      }
      if (parts[3] === "runs") {
        const item = row.turns.find(({ runId }) => runId === parts[4]);
        if (!item)
          return route.fulfill({
            status: 404,
            json: { error: "Message not available." },
          });
        if (parts[5] === "cancel")
          Object.assign(item, {
            status: "cancelled",
            completedAt: date,
            answer: null,
          });
        return route.fulfill({ json: { turn: item } });
      }
      if (method === "PATCH") {
        row.summary.title = route.request().postDataJSON().title;
        return route.fulfill({ json: { conversation: row.summary } });
      }
      if (method === "DELETE") {
        records.delete(id);
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({
        status: 404,
        json: { error: "Unknown conversation action." },
      });
    });
    await context.route("**/v1/qa/stream", async (route) => {
      const body = route.request().postDataJSON();
      submissions.push(body);
      expect(body.conversationId).toMatch(/^[a-f0-9-]{36}$/);
      expect(body.runId).toMatch(/^[a-f0-9-]{36}$/);
      expect(body.previousQuestions).toBeUndefined();
      let item = records
        .get(body.conversationId)!
        .turns.find(({ runId }) => runId === body.runId);
      item ??= turn(body.conversationId, body.question, body.runId);
      if (hold) {
        Object.assign(item, {
          status: "running",
          answer: null,
          completedAt: null,
        });
        return route.fulfill({
          contentType: "text/event-stream",
          body: 'id: 1\nevent: accepted\ndata: {"type":"accepted"}\n\n',
        });
      }
      if (route.request().headers().accept === "application/json")
        return route.fulfill({ status: 202, json: { turn: item } });
      return route.fulfill({
        contentType: "text/event-stream",
        body: `id: 1\nevent: completed\ndata: ${JSON.stringify({ type: "completed", response })}\n\n`,
      });
    });
    await context.route("**/v1/qa/runs/*/events?*", async (route) => {
      const id = new URL(route.request().url()).pathname.split("/")[4];
      const item = [...records.values()]
        .flatMap(({ turns }) => turns)
        .find(({ runId }) => runId === id)!;
      const event = hold
        ? { type: "accepted" }
        : { type: "completed", response };
      if (!hold)
        Object.assign(item, {
          status: "completed",
          answer: response,
          completedAt: date,
        });
      return route.fulfill({
        contentType: "text/event-stream",
        body: `${new URL(route.request().url()).searchParams.get("after") === "0" ? 'id: 1\nevent: accepted\ndata: {"type":"accepted"}\n\n' : ""}id: 2\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      });
    });
    await context.route("**/v1/qa/compare", async (route) => {
      const body = route.request().postDataJSON();
      submissions.push(body);
      const item = turn(
        body.conversationId,
        body.question,
        body.runId,
        "comparison",
      );
      return route.fulfill({ status: 202, json: { turn: item } });
    });
  }
  return {
    records,
    submissions,
    create,
    turn,
    attach,
    setHold: (value: boolean) => {
      hold = value;
    },
    failList: (value: boolean) => {
      listFailure = value;
    },
  };
}

const composer = (page: Page) =>
  page.getByRole("textbox", {
    name: /What would you like to know|O que você gostaria de saber/,
  });
const messages = (page: Page) =>
  page.getByRole("region", {
    name: /Conversation messages|Mensagens da conversa/,
  });
async function send(page: Page, text = question) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

test("private conversations reopen across devices with names, checked citations, feedback and deletion", async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(60000);
  const fixture = durableFixture();
  await fixture.attach(context);
  await page.goto("/ask");
  await send(page);
  await expect(
    messages(page).getByText(response.answer, { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/conversation=[a-f0-9-]{36}/);
  const id = new URL(page.url()).searchParams.get("conversation")!;
  await messages(page)
    .getByRole("button", { name: /👍 Helpful|👍 Útil/ })
    .click();
  await expect(
    messages(page).getByRole("button", { name: /👍 Helpful|👍 Útil/ }),
  ).toHaveAttribute("aria-pressed", "true");
  const navigation = page.getByRole("navigation", {
    name: /Main navigation|Navegação principal/,
  });
  await navigation.getByRole("button", { name: /^(Search|Buscar)$/ }).click();
  await navigation
    .getByRole("button", { name: /^(Ask|Chat|Perguntar|Conversa)$/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`conversation=${id}`));
  await page.reload();
  await expect(
    messages(page).getByText(question, { exact: true }),
  ).toBeVisible();
  await expect(
    messages(page).getByRole("button", { name: /👍 Helpful|👍 Útil/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await send(page, "Who approves my request?");
  await expect(
    messages(page).getByText(response.answer, { exact: true }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: /^(Chats|Conversas)$/ }).click();
  const library = page.getByRole("dialog", {
    name: /Your conversations|Suas conversas/,
  });
  await library.getByRole("button", { name: /^Rename |^Renomear / }).click();
  await library
    .getByRole("textbox", { name: /Conversation name|Nome da conversa/ })
    .fill("Team access");
  await library.getByRole("button", { name: /Save name|Salvar nome/ }).click();
  await expect(library.getByText("Team access", { exact: true })).toBeVisible();
  await expect(library).toHaveScreenshot("private-conversation-library.png");
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    audit.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target),
    })),
  ).toEqual([]);
  await library.getByRole("button", { name: /^Team access/ }).click();
  await expect(
    page.getByRole("heading", { name: "Team access", exact: true }),
  ).toBeVisible();
  await messages(page).evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await composer(page).focus();
  await expect(page).toHaveScreenshot("private-conversation-chat.png", {
    fullPage: true,
  });
  const browserData = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(browserData).not.toContain(question);
  expect(browserData).not.toContain(response.answer);
  const device = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    locale: "en-US",
    viewport: { width: 1280, height: 900 },
  });
  try {
    await fixture.attach(device);
    const other = await device.newPage();
    await other.goto(`/ask?conversation=${id}`);
    await expect(
      messages(other).getByText(question, { exact: true }),
    ).toBeVisible();
    await expect(
      messages(other)
        .getByRole("button", { name: /👍 Helpful|👍 Útil/ })
        .first(),
    ).toHaveAttribute("aria-pressed", "true");
    await messages(other)
      .getByRole("button", { name: /👎 Needs work|👎 Precisa melhorar/ })
      .first()
      .click();
    await expect(
      messages(other)
        .getByRole("button", { name: /👎 Needs work|👎 Precisa melhorar/ })
        .first(),
    ).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(
      messages(page)
        .getByRole("button", { name: /👎 Needs work|👎 Precisa melhorar/ })
        .first(),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /^(Chats|Conversas)$/ }).click();
    await library
      .getByRole("button", { name: "Delete Team access", exact: true })
      .or(
        library.getByRole("button", {
          name: "Excluir Team access",
          exact: true,
        }),
      )
      .click();
    await library
      .getByRole("button", { name: /^(Delete conversation|Excluir conversa)$/ })
      .click();
    await expect(library.getByText("Team access", { exact: true })).toHaveCount(
      0,
    );
    expect(fixture.records.size).toBe(0);
  } finally {
    await device.close();
  }
  expect(fixture.submissions.length).toBe(2);
  const width = await page.evaluate(() => ({
    actual: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(width.actual).toBeLessThanOrEqual(width.viewport);
});

test("a pending saved answer resumes after reload without a second submission", async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.name !== "desktop-en",
    "The recovery protocol is shared across viewports.",
  );
  const fixture = durableFixture();
  fixture.setHold(true);
  await fixture.attach(context);
  await page.goto("/ask");
  await send(page);
  await expect(page).toHaveURL(/conversation=/);
  await expect.poll(() => fixture.submissions.length).toBe(1);
  await page.reload();
  fixture.setHold(false);
  await expect(
    messages(page).getByText(response.answer, { exact: true }),
  ).toBeVisible();
  await expect(messages(page).getByText(question, { exact: true })).toHaveCount(
    1,
  );
  expect(fixture.submissions.length).toBe(1);
});

test("older messages paginate in order and history errors remain recoverable", async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.name !== "desktop-en",
    "Pagination and error recovery share one protocol.",
  );
  const fixture = durableFixture(),
    row = fixture.create(undefined, "Long conversation");
  for (let n = 1; n <= 28; n++)
    fixture.turn(row.summary.id, `Ordered message ${n}`);
  await fixture.attach(context);
  await page.goto(`/ask?conversation=${row.summary.id}`);
  await expect(
    messages(page).getByText("Ordered message 28", { exact: true }),
  ).toBeVisible();
  expect(
    await messages(page)
      .getByText("Ordered message 1", { exact: true })
      .count(),
  ).toBe(0);
  await messages(page)
    .getByRole("button", { name: "Load older messages" })
    .click();
  await expect(
    messages(page).getByText("Ordered message 1", { exact: true }),
  ).toHaveCount(1);
  const order = await messages(page).locator("ol > li").allTextContents();
  expect(order).toHaveLength(28);
  expect(order[0]).toContain("Ordered message 1");
  expect(order[27]).toContain("Ordered message 28");
  fixture.failList(true);
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible();
  fixture.failList(false);
  await page
    .getByRole("button", { name: "Try again", exact: true })
    .first()
    .click();
  await expect(composer(page)).toBeEnabled();
});

test("model comparisons are saved and reopen as one turn", async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.name !== "desktop-en",
    "Comparison persistence uses the same protocol across viewports.",
  );
  const fixture = durableFixture();
  await fixture.attach(context);
  await page.goto("/ask");
  await page.getByRole("checkbox", { name: "Compare two models" }).check();
  await send(page);
  await expect(
    messages(page).getByText(response.answer, { exact: true }),
  ).toHaveCount(2);
  await page.reload();
  await expect(
    messages(page).getByText(response.answer, { exact: true }),
  ).toHaveCount(2);
  expect(fixture.submissions.length).toBe(1);
  expect([...fixture.records.values()][0].turns).toHaveLength(1);
});

test("the HTTP fallback still saves the same conversation and stable execution ID", async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.name !== "desktop-en",
    "The non-streaming fallback is independent of viewport.",
  );
  const fixture = durableFixture();
  await fixture.attach(context);
  await context.addInitScript(() => {
    Object.defineProperty(window, "ReadableStream", { value: undefined });
  });
  await page.goto("/ask");
  await send(page);
  await expect(
    messages(page).getByText(response.answer, { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    messages(page).getByText(question, { exact: true }),
  ).toBeVisible();
  expect(fixture.submissions.length).toBe(1);
});

test("finishing the guide continues the same saved conversation in the main chat", async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.name !== "desktop-en",
    "The conversation handoff is shared across viewport profiles.",
  );
  const fixture = durableFixture({
    goal: "knowledge",
    step: "answer",
    completed: false,
  });
  await fixture.attach(context);
  await context.route("**/v1/admin/documents", (route) =>
    route.fulfill({
      json: {
        documents: [
          {
            id: "guide-doc",
            source: "team-handbook.md",
            title: "Team handbook",
            chunkCount: 2,
            createdAt: date,
            updatedAt: date,
          },
        ],
      },
    }),
  );
  await page.goto("/onboarding");
  await send(page);
  await expect(
    messages(page).getByText(response.answer, { exact: true }),
  ).toBeVisible();
  const id = [...fixture.records.keys()][0];
  await page.getByRole("button", { name: "Finish and open chat" }).click();
  await expect(page).toHaveURL(new RegExp(`/ask\\?conversation=${id}$`));
  await expect(
    messages(page).getByText(question, { exact: true }),
  ).toBeVisible();
  expect(fixture.submissions.length).toBe(1);
});
