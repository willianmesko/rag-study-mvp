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
          limit = Number(searchParams.get("limit") ?? 25),
          page = items.slice(-limit);
        expect(limit).toBeGreaterThan(0);
        expect(limit).toBeLessThanOrEqual(50);
        return route.fulfill({
          json: {
            conversation: row.summary,
            turns: page,
            nextBefore: items.length > limit ? page[0].sequence : null,
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

test("FE-06 refreshes only recent messages, retaining 75 turns, old feedback and reading position", async ({ page, context }) => {
  const fixture = durableFixture(), row = fixture.create(undefined, "FE-06 history");
  for (let i = 1; i <= 75; i++) fixture.turn(row.summary.id, `Visited message ${i}`);
  const reads: (string | null)[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/messages")) reads.push(url.searchParams.get("before"));
  });
  await fixture.attach(context);
  await page.clock.install();
  await page.goto(`/ask?conversation=${row.summary.id}`);
  await expect(messages(page).locator("ol > li")).toHaveCount(25);
  await messages(page).getByRole("button", { name: /Load older messages|Carregar mensagens anteriores/ }).click();
  await expect(messages(page).locator("ol > li")).toHaveCount(50);
  await messages(page).getByRole("button", { name: /Load older messages|Carregar mensagens anteriores/ }).click();
  await expect(messages(page).locator("ol > li")).toHaveCount(75);
  expect(reads).toEqual([null, "51", "26"]);
  const old = messages(page).locator("ol > li").filter({ has: page.getByText("Visited message 30", { exact: true }) });
  await old.getByRole("button", { name: /👍 Helpful|👍 Útil/ }).click();
  await expect(old.getByRole("button", { name: /👍 Helpful|👍 Útil/ })).toHaveAttribute("aria-pressed", "true");
  await old.scrollIntoViewIfNeeded();
  const position = await messages(page).evaluate((el) => el.scrollTop);
  fixture.turn(row.summary.id, "A new message on another device");
  const baseline = reads.length;
  await page.clock.fastForward(15_100);
  await expect(messages(page).locator("ol > li")).toHaveCount(76);
  expect(reads.slice(baseline)).toEqual([null]);
  await expect(old.getByRole("button", { name: /👍 Helpful|👍 Útil/ })).toHaveAttribute("aria-pressed", "true");
  expect(Math.abs(await messages(page).evaluate((el) => el.scrollTop) - position)).toBeLessThan(3);
  const nav = page.getByRole("navigation", { name: /Main navigation|Navegação principal/ });
  await nav.getByRole("button", { name: /^(Search|Buscar)$/ }).click();
  const hidden = reads.length;
  await page.clock.fastForward(45_000);
  expect(reads).toHaveLength(hidden);
  await nav.getByRole("button", { name: /^(History|Histórico)$/ }).click();
  await expect(page.getByRole("heading", { name: /Your conversations|Suas conversas/ })).toBeVisible();
  expect(reads).toHaveLength(hidden);
  await nav.getByRole("button", { name: /^(Ask|Perguntar)$/ }).click();
  await expect(messages(page).locator("ol > li")).toHaveCount(76);
  await expect.poll(() => reads.length).toBe(hidden + 1);
  expect(reads.at(-1)).toBeNull();
  expect(fixture.submissions).toHaveLength(0);
});

test("FE-06 a stream owns the active reader across navigation and one explicit stop", async ({ page, context }) => {
  const fixture = durableFixture();
  fixture.setHold(true);
  await fixture.attach(context);
  await context.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const result = await original(input, init);
      if (String(input).endsWith("/v1/qa/stream") && init?.method === "POST") {
        void result.body?.cancel();
        let abort: () => void;
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('id: 1\nevent: accepted\ndata: {"type":"accepted"}\n\n'));
            abort = () => controller.error(init.signal?.reason);
            init.signal?.addEventListener("abort", abort, { once: true });
          },
          cancel() { init.signal?.removeEventListener("abort", abort); },
        }), { headers: { "content-type": "text/event-stream" } });
      }
      return result;
    };
  });
  let messagesRead = 0, statusReads = 0, cancellations = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/messages")) messagesRead++;
    if (/\/runs\//.test(path) && request.method() === "GET") statusReads++;
    if (path.endsWith("/cancel")) cancellations++;
  });
  await page.clock.install();
  await page.goto("/ask");
  await send(page);
  await expect.poll(() => fixture.submissions.length).toBe(1);
  await expect(page.getByRole("button", { name: /^(Stop answer|Parar resposta)$/ })).toBeVisible();
  const baseline = messagesRead;
  await page.clock.fastForward(9_000);
  expect(messagesRead).toBe(baseline);
  expect(statusReads).toBe(0);
  const nav = page.getByRole("navigation", { name: /Main navigation|Navegação principal/ });
  await nav.getByRole("button", { name: /^(Search|Buscar)$/ }).click();
  await page.clock.fastForward(9_000);
  expect(cancellations).toBe(0);
  await nav.getByRole("button", { name: /^(Ask|Perguntar)$/ }).click();
  await page.getByRole("button", { name: /^(Stop answer|Parar resposta)$/ }).click();
  await expect.poll(() => cancellations).toBe(1);
  await expect(page.getByRole("button", { name: /^(Stop answer|Parar resposta)$/ })).toHaveCount(0);
  await page.clock.fastForward(5_000);
  expect(cancellations).toBe(1);
  expect(fixture.submissions).toHaveLength(1);
  expect([...fixture.records.values()][0].turns).toHaveLength(1);
});

test("FE-06 HTTP fallback has one status reader and never repeats admission", async ({ page, context }) => {
  const fixture = durableFixture();
  await fixture.attach(context);
  await context.addInitScript(() => Object.defineProperty(window, "ReadableStream", { value: undefined }));
  let statusReads = 0, headReads = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/messages")) headReads++;
    if (/\/runs\//.test(path) && request.method() === "GET") statusReads++;
  });
  await context.route("**/v1/qa/stream", (route) => {
    const input = route.request().postDataJSON();
    fixture.submissions.push(input);
    const turn = fixture.turn(input.conversationId, input.question, input.runId);
    Object.assign(turn, { status: "running", answer: null, completedAt: null });
    return route.fulfill({ status: 202, json: { turn } });
  });
  await page.clock.install();
  await page.goto("/ask");
  await send(page);
  await expect.poll(() => statusReads).toBe(1);
  const initial = headReads;
  await page.clock.fastForward(3_000);
  await expect.poll(() => statusReads).toBe(2);
  expect(headReads).toBe(initial);
  const turn = [...fixture.records.values()][0].turns[0];
  Object.assign(turn, { status: "completed", answer: response, completedAt: date });
  await page.clock.fastForward(700);
  await expect(messages(page).getByText(response.answer, { exact: true })).toBeVisible();
  expect(fixture.submissions).toHaveLength(1);
  expect([...fixture.records.values()][0].turns).toHaveLength(1);
});

for (const status of [401, 403, 429]) {
  test(`FE-06 conversation errors stop readers and recover without submission (${status})`, async ({ page, context }) => {
    const fixture = durableFixture(), row = fixture.create();
    fixture.turn(row.summary.id, "Already saved");
    await fixture.attach(context);
    let reads = 0, recover = false;
    await context.route("**/v1/conversations/*/messages?*", (route) => {
      reads++;
      return recover ? route.fallback() : route.fulfill({ status, json: { error: "Fixture access failure." } });
    });
    await page.clock.install();
    await page.goto(`/ask?conversation=${row.summary.id}`);
    await expect(page.getByRole("alert")).toBeVisible();
    const initial = reads;
    await page.clock.fastForward(35_000);
    expect(reads).toBe(initial);
    recover = true;
    await page.getByRole("button", { name: /^(Try again|Tentar novamente)$/ }).first().click();
    await expect(messages(page).getByText("Already saved", { exact: true })).toBeVisible();
    expect(fixture.submissions).toHaveLength(0);
  });
}

test("FE-06 pending history requests abort on navigation and reconnect keeps the durable path", async ({ page, context }) => {
  const fixture = durableFixture(), row = fixture.create();
  fixture.turn(row.summary.id, "Saved before a disconnect");
  await fixture.attach(context);
  await context.addInitScript(() => {
    const original = window.fetch;
    Object.assign(window, { abortedHistory: 0 });
    window.fetch = (input, init) => {
      if (String(input).includes("/messages?")) init?.signal?.addEventListener("abort", () => {
        const state = window as unknown as { abortedHistory: number }; state.abortedHistory++;
      }, { once: true });
      return original(input, init);
    };
  });
  let hold = true, release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await context.route("**/v1/conversations/*/messages?*", async (route) => {
    if (hold) await pending;
    return route.fallback();
  });
  try {
    await page.goto(`/ask?conversation=${row.summary.id}`);
    await expect(page.getByText(/Opening your conversation|Abrindo sua conversa/)).toBeVisible();
    const nav = page.getByRole("navigation", { name: /Main navigation|Navegação principal/ });
    await nav.getByRole("button", { name: /^(Search|Buscar)$/ }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { abortedHistory: number }).abortedHistory)).toBe(1);
    hold = false; release();
    await context.setOffline(true);
    await nav.getByRole("button", { name: /^(Ask|Perguntar)$/ }).click();
    await context.setOffline(false);
    await expect(messages(page).getByText("Saved before a disconnect", { exact: true })).toBeVisible();
    expect(fixture.submissions).toHaveLength(0);
    await send(page, "A follow-up after reconnect");
    await expect.poll(() => fixture.submissions.length).toBe(1);
    expect(fixture.submissions[0]).toMatchObject({ conversationId: row.summary.id });
  } finally { release(); }
});

test("FE-06 comparison polling owns its reader and coalesces repeated Stop clicks", async ({ page, context }) => {
  const fixture = durableFixture();
  await fixture.attach(context);
  await context.route("**/v1/qa/compare", (route) => {
    const input = route.request().postDataJSON();
    fixture.submissions.push(input);
    const turn = fixture.turn(input.conversationId, input.question, input.runId, "comparison");
    Object.assign(turn, { status: "running", comparison: null, completedAt: null });
    return route.fulfill({ status: 202, json: { turn } });
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await context.route("**/v1/conversations/*/runs/*/cancel", async (route) => { await held; return route.fallback(); });
  let heads = 0, statuses = 0, stops = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/messages")) heads++;
    if (path.includes("/runs/") && request.method() === "GET") statuses++;
    if (path.endsWith("/cancel")) stops++;
  });
  await page.clock.install();
  try {
    await page.goto("/ask");
    await page.getByRole("checkbox", { name: /Compare two models|Comparar dois modelos/ }).check();
    await send(page);
    await expect.poll(() => statuses).toBe(1);
    const initial = heads;
    await page.clock.fastForward(3_000);
    await expect.poll(() => statuses).toBe(2);
    expect(heads).toBe(initial);
    const stop = page.getByRole("button", { name: /^(Stop comparison|Parar comparação)$/ });
    await stop.click();
    const stopping = page.getByRole("button", { name: /^(Stopping…|Interrompendo…)$/ });
    await expect(stopping).toBeDisabled();
    await stopping.evaluate((button) => button.click());
    expect(stops).toBe(1);
    // Let the status reader see cancellation before the Stop response arrives.
    Object.assign([...fixture.records.values()][0].turns[0], { status: "cancelled", completedAt: date });
    await page.clock.fastForward(700);
    release();
    await expect(messages(page).getByText(/Comparison stopped|Comparação interrompida/)).toBeVisible();
    expect(stops).toBe(1);
    expect(fixture.submissions).toHaveLength(1);
  } finally { release(); }
});

test("FE-06 an exhausted stream hands reconciliation to the recent window without resubmitting", async ({ page, context }) => {
  const fixture = durableFixture();
  fixture.setHold(true);
  await fixture.attach(context);
  let resumes = 0;
  page.on("request", (request) => { if (request.url().includes("/events?after=")) resumes++; });
  await page.clock.install();
  await page.goto("/ask");
  await send(page);
  await expect.poll(() => fixture.submissions.length).toBe(1);
  for (const [index, delay] of [400, 1_200, 3_000].entries()) {
    await page.clock.fastForward(delay + 50);
    await expect.poll(() => resumes).toBe(index + 1);
    // Flush the response and schedule the next bounded reconnect delay.
    await page.clock.runFor(50);
  }
  await expect(page.getByRole("button", { name: /^(Reconnect|Reconectar)$/ })).toBeVisible();
  const row = [...fixture.records.values()][0];
  Object.assign(row.turns[0], { status: "completed", answer: response, completedAt: date });
  await page.clock.fastForward(2_100);
  await expect(messages(page).getByText(response.answer, { exact: true })).toBeVisible();
  expect(fixture.submissions).toHaveLength(1);
  expect(row.turns).toHaveLength(1);
  expect(resumes).toBe(3);
});

test("FE-06 a confirmed HTTP admission is not repeated after a read failure or reload", async ({ page, context }) => {
  const fixture = durableFixture();
  await fixture.attach(context);
  await context.addInitScript(() => Object.defineProperty(window, "ReadableStream", { value: undefined }));
  await context.route("**/v1/qa/stream", (route) => {
    const input = route.request().postDataJSON();
    fixture.submissions.push(input);
    const turn = fixture.turn(input.conversationId, input.question, input.runId);
    Object.assign(turn, { status: "running", answer: null, completedAt: null });
    return route.fulfill({ status: 202, json: { turn } });
  });
  let reads = 0;
  await context.route("**/v1/conversations/*/runs/*", (route) => {
    reads++;
    return reads === 1 ? route.fulfill({ status: 503, json: { error: "Fixture read failure after admission." } }) : route.fallback();
  });
  await page.clock.install();
  await page.goto("/ask");
  await send(page);
  await expect(messages(page).getByText(/Reconnecting to the same answer|Reconectando à mesma resposta/)).toBeVisible();
  await page.clock.fastForward(450);
  await expect.poll(() => reads).toBe(2);
  expect(fixture.submissions).toHaveLength(1);
  await page.reload();
  await expect.poll(() => reads).toBeGreaterThanOrEqual(3);
  expect(fixture.submissions).toHaveLength(1);
  const row = [...fixture.records.values()][0];
  Object.assign(row.turns[0], { status: "completed", answer: response, completedAt: date });
  await page.clock.fastForward(700);
  await expect(messages(page).getByText(response.answer, { exact: true })).toBeVisible();
  expect(row.turns).toHaveLength(1);
  expect(fixture.submissions).toHaveLength(1);
});

test("FE-07 creation retries reuse the draft ID and rapid submissions admit one ordered turn", async ({ page, context }) => {
  const fixture = durableFixture();
  await fixture.attach(context);
  const ids: string[] = [];
  await context.route("**/v1/conversations", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const { id } = route.request().postDataJSON();
    ids.push(id);
    const row = fixture.records.get(id) ?? fixture.create(id);
    return ids.length === 1 ? route.fulfill({ status: 503, json: { error: "Fixture uncertain creation." } })
      : route.fulfill({ status: 201, json: { conversation: row.summary } });
  });
  await page.goto("/ask");
  await send(page);
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: /^(Try again|Tentar novamente)$/ }).click();
  await composer(page).fill(question);
  await composer(page).evaluate((input) => { input.closest("form")!.requestSubmit(); input.closest("form")!.requestSubmit(); });
  await expect(messages(page).getByText(response.answer, { exact: true })).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  expect(fixture.records.size).toBe(1);
  expect(fixture.submissions).toHaveLength(1);
  expect([...fixture.records.values()][0].turns.map((turn) => turn.sequence)).toEqual([1]);
});

test("FE-07 late creation cannot replace a conversation opened during submission", async ({ page, context }) => {
  const fixture = durableFixture(), existing = fixture.create(undefined, "Existing conversation");
  fixture.turn(existing.summary.id, "An existing saved message");
  await fixture.attach(context);
  let release!: () => void, creates = 0;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await context.route("**/v1/conversations", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    creates++;
    const row = fixture.create(route.request().postDataJSON().id);
    await held;
    return route.fulfill({ status: 201, json: { conversation: row.summary } });
  });
  try {
    await page.goto("/ask");
    await send(page, "Do not send this after navigating");
    await expect.poll(() => creates).toBe(1);
    await page.getByRole("navigation", { name: /Main navigation|Navegação principal/ }).getByRole("button", { name: /^(History|Histórico)$/ }).click();
    await page.getByRole("button", { name: /^Existing conversation/ }).click();
    await expect(messages(page).getByText("An existing saved message", { exact: true })).toBeVisible();
    release();
    await expect(page).toHaveURL(new RegExp(`conversation=${existing.summary.id}$`));
    await expect.poll(() => page.getByRole("button", { name: /^(Send message|Enviar mensagem)$/ }).isDisabled()).toBe(true);
    await send(page, "A deliberate question in the selected conversation");
    const reply = messages(page).locator("ol > li").filter({ has: page.getByText("A deliberate question in the selected conversation", { exact: true }) });
    await expect(reply.getByText(response.answer, { exact: true })).toBeVisible();
    expect(fixture.submissions).toHaveLength(1);
    expect(fixture.submissions[0]).toMatchObject({ conversationId: existing.summary.id, question: "A deliberate question in the selected conversation" });
    expect(existing.turns.map((turn) => turn.sequence)).toEqual([1, 2]);
  } finally { release(); }
});

test("FE-07 leaving Ask during creation does not navigate back or start the model", async ({ page, context }) => {
  const fixture = durableFixture();
  await fixture.attach(context);
  let release!: () => void, creates = 0, delivered = false;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await context.route("**/v1/conversations", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    creates++;
    const row = fixture.records.get(route.request().postDataJSON().id) ?? fixture.create(route.request().postDataJSON().id);
    if (creates === 1) await held;
    await route.fulfill({ status: 201, json: { conversation: row.summary } });
    delivered = true;
  });
  try {
    await page.goto("/ask");
    await send(page);
    await expect.poll(() => creates).toBe(1);
    await expect(page.getByRole("button", { name: /^(Sending…|Enviando…)$/ })).toBeDisabled();
    const nav = page.getByRole("navigation", { name: /Main navigation|Navegação principal/ });
    await nav.getByRole("button", { name: /^(Search|Buscar)$/ }).click();
    release();
    await expect.poll(() => delivered).toBe(true);
    await expect(page).toHaveURL(/\/search$/);
    expect(fixture.submissions).toHaveLength(0);
    await nav.getByRole("button", { name: /^(Ask|Perguntar)$/ }).click();
    await send(page, "Send only after returning");
    await expect(messages(page).getByText(response.answer, { exact: true })).toBeVisible();
    expect(fixture.submissions).toHaveLength(1);
    expect(fixture.records.size).toBe(1);
  } finally { release(); }
});

test("FE-07 duplicate stream IDs do not duplicate tokens and online after completion stays settled", async ({ page, context }) => {
  const fixture = durableFixture();
  await fixture.attach(context);
  const frame = (id: number, type: string, extra = {}) => `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`;
  await context.route("**/v1/qa/stream", (route) => {
    const input = route.request().postDataJSON(); fixture.submissions.push(input);
    Object.assign(fixture.turn(input.conversationId, input.question, input.runId), { status: "running", answer: null, completedAt: null });
    return route.fulfill({ contentType: "text/event-stream", body: frame(1, "accepted") + frame(2, "token", { delta: "Opening words" }) + frame(2, "token", { delta: "DUPLICATE" }) });
  });
  let resumes = 0, release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await context.route("**/v1/qa/runs/*/events?*", async (route) => {
    resumes++;
    expect(new URL(route.request().url()).searchParams.get("after")).toBe("2");
    await held;
    const item = [...fixture.records.values()][0].turns[0];
    Object.assign(item, { status: "completed", answer: response, completedAt: date });
    return route.fulfill({ contentType: "text/event-stream", body: frame(2, "token", { delta: "DUPLICATE" }) + frame(3, "token", { delta: " finish" }) + frame(4, "citations", { sources: response.sources }) + frame(5, "completed", { response }) });
  });
  try {
    await page.goto("/ask"); await send(page);
    await expect(messages(page).getByText("Opening words", { exact: true })).toBeVisible();
    await expect.poll(() => resumes).toBe(1);
    expect(await messages(page).textContent()).not.toContain("DUPLICATE");
    release();
    await expect(messages(page).getByText(response.answer, { exact: true })).toBeVisible();
    await page.evaluate(() => { for (let i = 0; i < 3; i++) window.dispatchEvent(new Event("online")); });
    await expect(page.getByRole("button", { name: /^(Reconnect|Reconectar|Stop answer|Parar resposta)$/ })).toHaveCount(0);
    expect(resumes).toBe(1); expect(fixture.submissions).toHaveLength(1);
    expect([...fixture.records.values()][0].turns).toHaveLength(1);
  } finally { release(); }
});

test("FE-07 an unknown admission retries the same run ID without duplicating the turn", async ({ page, context }) => {
  const fixture = durableFixture();
  await fixture.attach(context);
  const bodies: Record<string, unknown>[] = [];
  await context.route("**/v1/qa/stream", (route) => {
    const input = route.request().postDataJSON(); bodies.push(input);
    if (bodies.length === 1) {
      Object.assign(fixture.turn(input.conversationId, input.question, input.runId), { status: "running", answer: null, completedAt: null });
      return route.abort("failed");
    }
    const item = [...fixture.records.values()][0].turns[0];
    Object.assign(item, { status: "completed", answer: response, completedAt: date });
    return route.fulfill({ contentType: "text/event-stream", body: `id: 1\nevent: completed\ndata: ${JSON.stringify({ type: "completed", response })}\n\n` });
  });
  await context.route("**/v1/qa/runs/*/events?*", (route) => route.fulfill({ status: 404, json: { error: "Admission not yet visible." } }));
  await page.goto("/ask"); await send(page);
  await expect(messages(page).getByText(response.answer, { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0].runId).toBe(bodies[1].runId);
  expect(bodies[0].conversationId).toBe(bodies[1].conversationId);
  expect([...fixture.records.values()][0].turns.map((turn) => turn.sequence)).toEqual([1]);
});

for (const mode of ["answer", "comparison"] as const) {
  test(`FE-07 unconfirmed ${mode} cancellation keeps the execution and accepts its delayed completion`, async ({ page, context }) => {
    const fixture = durableFixture();
    await fixture.attach(context);
    await context.addInitScript(() => Object.defineProperty(window, "ReadableStream", { value: undefined }));
    let admitted: ConversationTurn | undefined, completed: ConversationTurn | undefined, stops = 0;
    await context.route(mode === "answer" ? "**/v1/qa/stream" : "**/v1/qa/compare", (route) => {
      const input = route.request().postDataJSON(); fixture.submissions.push(input);
      admitted = fixture.turn(input.conversationId, input.question, input.runId, mode);
      completed = { ...admitted };
      Object.assign(admitted, { status: "running", answer: null, comparison: null, completedAt: null });
      return route.fulfill({ status: 202, json: { turn: admitted } });
    });
    await context.route("**/v1/conversations/*/runs/*/cancel", (route) => {
      stops++;
      return route.fulfill({ status: 503, json: { error: "Fixture cancellation could not be confirmed." } });
    });
    await page.clock.install();
    await page.goto("/ask");
    if (mode === "comparison") await page.getByRole("checkbox", { name: /Compare two models|Comparar dois modelos/ }).check();
    await send(page);
    const stop = page.getByRole("button", { name: mode === "answer" ? /^(Stop answer|Parar resposta)$/ : /^(Stop comparison|Parar comparação)$/ });
    await expect(stop).toBeEnabled(); await stop.click();
    await expect(page.getByRole("alert")).toContainText(/could not confirm|Não foi possível confirmar/);
    await expect(stop).toBeEnabled();
    Object.assign(admitted!, completed!);
    await page.clock.fastForward(700);
    if (mode === "answer") await expect(messages(page).getByText(response.answer, { exact: true })).toBeVisible();
    else await expect(messages(page).getByText(response.answer, { exact: true })).toHaveCount(2);
    await expect(stop).toHaveCount(0);
    expect(stops).toBe(1); expect(fixture.submissions).toHaveLength(1);
    expect([...fixture.records.values()][0].turns).toHaveLength(1);
  });
}

test("FE-07 completed answer racing Stop uses the authoritative result once", async ({ page, context }) => {
  const fixture = durableFixture();
  await fixture.attach(context);
  await context.addInitScript(() => Object.defineProperty(window, "ReadableStream", { value: undefined }));
  let item!: ConversationTurn, release!: () => void, stops = 0;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await context.route("**/v1/qa/stream", (route) => {
    const input = route.request().postDataJSON(); fixture.submissions.push(input);
    item = fixture.turn(input.conversationId, input.question, input.runId);
    Object.assign(item, { status: "running", answer: null, completedAt: null });
    return route.fulfill({ status: 202, json: { turn: item } });
  });
  await context.route("**/v1/conversations/*/runs/*/cancel", async (route) => {
    stops++; await held;
    return route.fulfill({ json: { turn: item } });
  });
  await page.clock.install();
  try {
    await page.goto("/ask"); await send(page);
    await page.getByRole("button", { name: /^(Stop answer|Parar resposta)$/ }).click();
    const stopping = page.getByRole("button", { name: /^(Stopping…|Interrompendo…)$/ });
    await expect(stopping).toBeDisabled();
    Object.assign(item, { status: "completed", answer: response, completedAt: date });
    await page.clock.fastForward(700);
    await expect(stopping).toBeDisabled();
    release();
    await expect(messages(page).getByText(response.answer, { exact: true })).toBeVisible();
    await expect(stopping).toHaveCount(0);
    expect(stops).toBe(1); expect(fixture.submissions).toHaveLength(1);
    expect([...fixture.records.values()][0].turns).toHaveLength(1);
  } finally { release(); }
});
