import { randomUUID } from "node:crypto";
import { expect, type BrowserContext } from "@playwright/test";
import type { ConversationSummary, ConversationTurn, QuestionResponse } from "@rag-study/contracts";
import { workspaceFixture } from "./workspace-fixture";

export const workspaceId = "11111111-1111-4111-a111-111111111111";
export const question = "How do I request access?";
export const response: QuestionResponse = {
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
export const date = "2026-11-07T12:00:00.000Z";

/** A product API fixture shared by independent browser contexts, never browser storage. */
export function durableFixture(
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

