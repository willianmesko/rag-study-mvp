import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, randomBytes } from "node:crypto";
import { Pool } from "pg";
import type { QuestionResponse, QuestionInput } from "@rag-study/contracts";
import { PgConversationRepository } from "./pg-conversation-repository.js";
import { PgChatRunRepository } from "./pg-chat-run-repository.js";
import { PgWorkflowRepository } from "./pg-workflow-repository.js";
import { WorkflowStateCodec } from "../security/workflow-state-codec.js";
import { ConversationError } from "../../application/ports/conversation-repository.js";
import { ConversationDelivery } from "../../application/conversations/delivery.js";
import { buildApp } from "../../interfaces/http/app.js";
import { config } from "../../config.js";
import { safeHttpLogSerializers } from "../../interfaces/http/safe-logging.js";
import { setTimeout as delay } from "node:timers/promises";
import {
  conversationPageSchema,
  conversationMessagesSchema,
} from "@rag-study/contracts";

const databaseUrl = process.env.MCP_TEST_DATABASE_URL;
test(
  "durable conversations enforce ownership, atomic publication, ordering, retention and deletion",
  { skip: !databaseUrl, timeout: 45000 },
  async (t) => {
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(
        new URL(databaseUrl!).hostname,
      ),
      "Use a disposable local database.",
    );
    const pool = new Pool({ connectionString: databaseUrl, max: 8 }),
      repo = new PgConversationRepository(pool),
      runs = new PgChatRunRepository(pool);
    const tenantId = randomUUID(),
      otherTenant = randomUUID(),
      userId = randomUUID(),
      peerId = randomUUID(),
      scope = { tenantId, userId };
    t.after(async () => {
      try {
        await pool.query(
          "DELETE FROM documents WHERE tenant_id=ANY($1::uuid[])",
          [[tenantId, otherTenant]],
        );
        await pool.query("DELETE FROM tenants WHERE id=ANY($1::uuid[])", [
          [tenantId, otherTenant],
        ]);
      } finally {
        await pool.end();
      }
    });
    await pool.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Conversation fixture'),($3,$4,'Other conversation fixture')",
      [tenantId, "conv-" + tenantId, otherTenant, "conv-" + otherTenant],
    );
    await pool.query(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'viewer'),($1,$3,'owner'),($4,$2,'owner')",
      [tenantId, userId, peerId, otherTenant],
    );
    const {
      rows: [doc],
    } = await pool.query<{ id: string }>(
      "INSERT INTO documents(tenant_id,source,title) VALUES($1,'handbook.md','Team handbook') RETURNING id",
      [tenantId],
    );
    const {
      rows: [chunk],
    } = await pool.query<{ id: string }>(
      "INSERT INTO chunks(document_id,ordinal,content,embedding) VALUES($1,0,'Records are kept for five days.',$2::vector) RETURNING id",
      [doc!.id, JSON.stringify([1, ...Array(1023).fill(0)])],
    );
    const answer: QuestionResponse = {
      answer: "Records are kept for five days.",
      structuredOutput: true,
      citedChunkIds: [chunk!.id],
      sources: [
        {
          chunkId: chunk!.id,
          documentId: doc!.id,
          source: "handbook.md",
          title: "Team handbook",
          chunk: 0,
          score: 0.9,
          excerpt: "Records are kept for five days.",
        },
      ],
      model: {
        id: "default",
        label: "Study model",
        provider: "openrouter",
        isDefault: true,
      },
      providerModel: "fixture/chat",
      usage: {
        source: "observed",
        inputTokens: 80,
        outputTokens: 12,
        latencyMs: 123,
        estimatedCostUsd: 0.00001,
        promptVersion: "grounded-v1",
        citationCount: 1,
        safetyOutcome: "validated",
      },
    };
    const id = randomUUID(),
      conversation = { ...scope, conversationId: id };
    const runScope = (runId: string, cid: string = id) => ({
      tenantId,
      actorId: userId,
      runId,
      conversationId: cid,
    });
    async function complete(
      question: string,
      runId: string = randomUUID(),
      cid: string = id,
    ) {
      const submission = {
        ...scope,
        conversationId: cid,
        runId,
        mode: "answer" as const,
        input: { question },
      };
      const turn = await repo.admit(submission);
      await runs.create(runScope(runId, cid), 30000);
      await runs.append(
        runScope(runId, cid),
        [{ type: "completed", response: answer }],
        "completed",
      );
      return turn;
    }

    await t.test(
      "create is idempotent and a workspace owner cannot read another member’s conversation",
      async () => {
        assert.equal(
          (await repo.create(scope, id, "Private handbook chat")).id,
          id,
        );
        assert.equal(
          (await repo.create(scope, id, "Changed replay title")).title,
          "Private handbook chat",
        );
        await assert.rejects(
          repo.messages({ ...conversation, userId: peerId }, 10),
          ConversationError,
        );
        await assert.rejects(
          repo.messages({ ...conversation, tenantId: otherTenant }, 10),
          ConversationError,
        );
        assert.equal(
          (await repo.list({ ...scope, userId: peerId }, 10)).conversations
            .length,
          0,
        );
        await repo.delete({ ...conversation, userId: peerId });
        assert.equal(
          (await repo.messages(conversation, 10)).conversation.id,
          id,
        );
      },
    );
    await t.test(
      "concurrent retries create one turn and two immutable message IDs",
      async () => {
        const runId = randomUUID(),
          input = {
            ...conversation,
            runId,
            mode: "answer" as const,
            input: { question: "What is the retention period?" },
          };
        const turns = await Promise.all(
          Array.from({ length: 12 }, () => repo.admit(input)),
        );
        assert.equal(
          new Set(turns.map(({ assistantMessageId }) => assistantMessageId))
            .size,
          1,
        );
        assert.equal(
          new Set(turns.map(({ userMessageId }) => userMessageId)).size,
          1,
        );
        assert.equal((await repo.messages(conversation, 10)).turns.length, 1);
        await assert.rejects(
          repo.admit({ ...input, input: { question: "Changed question" } }),
          (error: unknown) =>
            error instanceof ConversationError &&
            error.code === "idempotency_conflict",
        );
        await assert.rejects(
          repo.admit({ ...input, runId: randomUUID() }),
          (error: unknown) =>
            error instanceof ConversationError &&
            error.code === "conversation_busy",
        );
        await runs.create(runScope(runId), 30000);
        assert.equal((await repo.turn(conversation, runId))?.status, "running");
        await runs.append(
          runScope(runId),
          [{ type: "completed", response: answer }],
          "completed",
        );
        assert.equal(
          await runs.append(
            runScope(runId),
            [{ type: "completed", response: answer }],
            "completed",
          ),
          false,
        );
        const stored = (await repo.messages(conversation, 10)).turns[0]!;
        assert.equal(stored.status, "completed");
        assert.equal(stored.answer?.providerModel, "fixture/chat");
        assert.equal(stored.answer?.usage?.inputTokens, 80);
        assert.equal(stored.userMessageId, turns[0]!.userMessageId);
        assert.equal(stored.assistantMessageId, turns[0]!.assistantMessageId);
      },
    );
    await t.test(
      "a run ID cannot be moved between conversations or attached to a legacy execution",
      async () => {
        const a = randomUUID(),
          b = randomUUID(),
          runId = randomUUID();
        await repo.create(scope, a);
        await repo.create(scope, b);
        const attempt = (conversationId: string) =>
          repo.admit({
            ...scope,
            conversationId,
            runId,
            mode: "answer",
            input: { question: "One immutable submission" },
          });
        const results = await Promise.allSettled([attempt(a), attempt(b)]);
        assert.equal(
          results.filter(({ status }) => status === "fulfilled").length,
          1,
        );
        const failure = results.find((result) => result.status === "rejected");
        assert.ok(
          failure?.status === "rejected" &&
            failure.reason instanceof ConversationError &&
            failure.reason.status === 409,
        );
        const success = results.find((result) => result.status === "fulfilled");
        assert.ok(success?.status === "fulfilled");
        await repo.cancelPending(
          { ...scope, conversationId: success.value.conversationId },
          runId,
        );
        assert.equal(
          (
            await repo.turn(
              { ...scope, conversationId: success.value.conversationId },
              runId,
            )
          )?.status,
          "cancelled",
        );
        const legacyId = randomUUID();
        await runs.create(
          { tenantId, actorId: userId, runId: legacyId },
          30000,
        );
        await assert.rejects(
          repo.admit({
            ...scope,
            conversationId: a,
            runId: legacyId,
            mode: "answer",
            input: { question: "Reassign an existing execution" },
          }),
          (error: unknown) =>
            error instanceof ConversationError &&
            error.code === "idempotency_conflict",
        );
        await runs.cancel({ tenantId, actorId: userId, runId: legacyId });
      },
    );
    await t.test(
      "checked citations and completed history commit atomically with the replay event",
      async () => {
        const turn = await repo.admit({
          ...conversation,
          runId: randomUUID(),
          mode: "answer",
          input: { question: "Cite the handbook." },
        });
        await runs.create(runScope(turn.runId), 30000);
        const invalid = { ...answer, citedChunkIds: [randomUUID()] };
        await assert.rejects(
          runs.append(
            runScope(turn.runId),
            [{ type: "completed", response: invalid }],
            "completed",
          ),
          { code: "23514" },
        );
        assert.equal(await runs.get(runScope(turn.runId)), "running");
        assert.equal((await repo.turn(conversation, turn.runId))?.answer, null);
        await runs.append(
          runScope(turn.runId),
          [{ type: "completed", response: answer }],
          "completed",
        );
        assert.equal(
          (await repo.turn(conversation, turn.runId))?.answer
            ?.citedChunkIds?.[0],
          chunk!.id,
        );
      },
    );
    await t.test(
      "server history supplies bounded same-conversation context and messages paginate without gaps",
      async () => {
        for (let n = 0; n < 5; n++) await complete("Follow-up " + n);
        const pending = await repo.admit({
          ...conversation,
          runId: randomUUID(),
          mode: "answer",
          input: {
            question: "Who approves?",
            previousQuestions: ["FORGED BROWSER CONTEXT"],
          },
        });
        assert.deepEqual((pending.input as QuestionInput).previousQuestions, [
          "Follow-up 2",
          "Follow-up 3",
          "Follow-up 4",
        ]);
        await runs.create(runScope(pending.runId), 30000);
        await runs.cancel(runScope(pending.runId));
        const first = await repo.messages(conversation, 3),
          second = await repo.messages(conversation, 3, first.nextBefore!),
          third = await repo.messages(conversation, 3, second.nextBefore!);
        const ids = [...third.turns, ...second.turns, ...first.turns].map(
          ({ runId }) => runId,
        );
        assert.equal(new Set(ids).size, 8);
        assert.equal(third.nextBefore, null);
        const otherId = randomUUID();
        await repo.create(scope, otherId);
        const other = await repo.admit({
          ...scope,
          conversationId: otherId,
          runId: randomUUID(),
          mode: "answer",
          input: { question: "New context." },
        });
        assert.equal(
          (other.input as QuestionInput).previousQuestions,
          undefined,
        );
        await runs.create(runScope(other.runId, otherId), 30000);
        await runs.cancel(runScope(other.runId, otherId));
      },
    );
    await t.test(
      "ratings are idempotent, clearable and restricted to a completed owned assistant message",
      async () => {
        const turn = (await repo.messages(conversation, 10)).turns[0]!;
        await repo.feedback(conversation, turn.assistantMessageId, "up");
        await repo.feedback(conversation, turn.assistantMessageId, "up");
        assert.equal(
          (await repo.turn(conversation, turn.runId))?.feedback,
          "up",
        );
        await repo.feedback(conversation, turn.assistantMessageId, "down");
        await repo.feedback(conversation, turn.assistantMessageId, null);
        await assert.rejects(
          repo.feedback(
            { ...conversation, userId: peerId },
            turn.assistantMessageId,
            "down",
          ),
          ConversationError,
        );
        await assert.rejects(
          repo.feedback(conversation, turn.userMessageId, "up"),
          ConversationError,
        );
        const stopped = (await repo.messages(conversation, 1)).turns[0]!;
        await assert.rejects(
          repo.feedback(conversation, stopped.assistantMessageId, "up"),
          ConversationError,
        );
      },
    );
    await t.test(
      "a new repository opens the same named conversation and microsecond list pagination does not skip records",
      async () => {
        await repo.rename(conversation, "Access team");
        assert.equal(
          (await new PgConversationRepository(pool).messages(conversation, 1))
            .conversation.title,
          "Access team",
        );
        for (let n = 0; n < 8; n++) {
          const cid = randomUUID();
          await repo.create(scope, cid, "Page " + n);
          await pool.query(
            "UPDATE conversations SET created_at='2026-11-07T12:00:00.123456Z'::timestamptz-$4::int*interval '1 microsecond' WHERE tenant_id=$1 AND owner_id=$2 AND id=$3",
            [tenantId, userId, cid, n],
          );
        }
        let cursor: string | undefined;
        const ids: string[] = [];
        do {
          const page = await repo.list(scope, 2, cursor);
          ids.push(...page.conversations.map(({ id }) => id));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        const count = await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM conversations WHERE tenant_id=$1 AND owner_id=$2",
          [tenantId, userId],
        );
        assert.equal(ids.length, count.rows[0]!.n);
        assert.equal(new Set(ids).size, ids.length);
        await assert.rejects(
          repo.list(
            scope,
            2,
            Buffer.from(JSON.stringify({ at: "SQL invalid", id })).toString(
              "base64url",
            ),
          ),
          ConversationError,
        );
      },
    );
    await t.test(
      "the persisted admission outbox recovers once and does not reserve or call a provider again",
      async () => {
        const cid = randomUUID();
        await repo.create(scope, cid);
        const runId = randomUUID();
        await repo.admit({
          ...scope,
          conversationId: cid,
          runId,
          mode: "answer",
          input: { question: "Recover me." },
        });
        let executions = 0;
        const shutdown = new AbortController();
        const delivery = new ConversationDelivery(
          repo,
          runs,
          async (item) => {
            executions++;
            await runs.create(runScope(item.runId, item.conversationId), 30000);
            await runs.append(
              runScope(item.runId, item.conversationId),
              [{ type: "completed", response: answer }],
              "completed",
            );
          },
          async () => {
            throw new Error("Unexpected comparison.");
          },
          shutdown.signal,
          30000,
          () => {},
        );
        await delivery.recover();
        await delivery.recover();
        assert.equal(executions, 1);
        assert.equal(
          (await repo.turn({ ...scope, conversationId: cid }, runId))?.status,
          "completed",
        );
        shutdown.abort();
        await delivery.close();
      },
    );
    await t.test(
      "deleting a conversation cascades into replay and encrypted workflow records",
      async () => {
        const cid = randomUUID(),
          runId = randomUUID();
        await repo.create(scope, cid);
        await repo.admit({
          ...scope,
          conversationId: cid,
          runId,
          mode: "answer",
          input: { question: "Delete this private input." },
        });
        const workflow = new PgWorkflowRepository(
          pool,
          new WorkflowStateCodec(randomBytes(32).toString("base64")),
        );
        await workflow.admit({
          tenantId,
          actorId: userId,
          runId,
          conversationId: cid,
          kind: "chat",
          version: "conversation-test",
          input: { question: "Private encrypted checkpoint input" },
          budget: {
            maxSteps: 10,
            maxCalls: 3,
            maxInputTokens: 1000,
            maxOutputTokens: 1000,
            maxCostMicros: 10000,
            timeoutMs: 30000,
          },
        });
        assert.equal(await runs.get(runScope(runId, cid)), "running");
        await repo.delete({ ...scope, conversationId: cid });
        assert.equal(await runs.get(runScope(runId, cid)), null);
        assert.equal(
          await workflow.get({ tenantId, actorId: userId, runId }),
          null,
        );
        assert.equal(
          await repo.turn({ ...scope, conversationId: cid }, runId),
          null,
        );
        await repo.delete({ ...scope, conversationId: cid });
        await assert.rejects(runs.create(runScope(randomUUID(), cid), 30000), {
          code: "23503",
        });
      },
    );
    await t.test(
      "expired conversations are inaccessible and pruning removes product contents",
      async () => {
        const cid = randomUUID();
        await repo.create(scope, cid);
        await complete("An old private question.", randomUUID(), cid);
        await pool.query(
          "UPDATE conversations SET expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND owner_id=$2 AND id=$3",
          [tenantId, userId, cid],
        );
        await assert.rejects(
          repo.messages({ ...scope, conversationId: cid }, 10),
          ConversationError,
        );
        assert.ok(
          !(await repo.list(scope, 50)).conversations.some(
            ({ id }) => id === cid,
          ),
        );
        await repo.pruneExpired();
        assert.equal(
          (
            await pool.query(
              "SELECT 1 FROM conversation_turns WHERE conversation_id=$1",
              [cid],
            )
          ).rowCount,
          0,
        );
      },
    );
    await t.test(
      "HTTP history, JSON admission, stream replay, comparison and cancellation preserve private ordered history",
      async (t) => {
        const previous = {
          SUPABASE_URL: config.SUPABASE_URL,
          SUPABASE_PUBLISHABLE_KEY: config.SUPABASE_PUBLISHABLE_KEY,
          API_KEY: config.API_KEY,
          AGENT_TIMEOUT_MS: config.AGENT_TIMEOUT_MS,
          RATE_LIMIT_MAX: config.RATE_LIMIT_MAX,
          QA_RATE_LIMIT_MAX: config.QA_RATE_LIMIT_MAX,
        };
        Object.assign(config, {
          SUPABASE_URL: "https://conversation-auth.example.test",
          SUPABASE_PUBLISHABLE_KEY: "fixture",
          API_KEY: undefined,
          AGENT_TIMEOUT_MS: 8000,
          RATE_LIMIT_MAX: 1000,
          QA_RATE_LIMIT_MAX: 500,
        });
        t.after(() => Object.assign(config, previous));
        t.mock.method(
          globalThis,
          "fetch",
          async (url: string, init?: RequestInit) => {
            assert.equal(
              String(url),
              "https://conversation-auth.example.test/auth/v1/user",
            );
            const token = new Headers(init?.headers).get("authorization");
            return token === "Bearer member" || token === "Bearer peer"
              ? Response.json({
                  id: token === "Bearer member" ? userId : peerId,
                  aud: "authenticated",
                  role: "authenticated",
                })
              : Response.json({ message: "Invalid token" }, { status: 401 });
          },
        );
        const audit: unknown[] = [];
        let calls = 0,
          quota = 0,
          compareCalls = 0,
          aborted = false;
        const source = {
          chunkId: chunk!.id,
          documentId: doc!.id,
          source: "handbook.md",
          title: "Team handbook",
          ordinal: 0,
          score: 0.9,
          content: "Records are kept for five days.",
        };
        const generated = { ...answer, sources: [source] };
        const execute = async (input: {
          question: string;
          bypassCache?: boolean;
          signal?: AbortSignal;
        }) => {
          assert.equal(input.bypassCache, true);
          calls++;
          if (input.question === "Wait for deletion") {
            try {
              await delay(7000, undefined, { signal: input.signal });
            } catch {
              aborted = true;
              throw new Error("Private upstream exception");
            }
          }
          return generated;
        };
        const model = {
          descriptor: {
            id: "default",
            label: "Study model",
            provider: "openrouter",
            isDefault: true,
          },
          model: "fixture/chat",
          answerQuestion: { execute },
        };
        const app = await buildApp({
          conversations: repo,
          chatRuns: runs,
          answerQuestion: { execute },
          chatModels: new Map([["default", model]]),
          consumeQuestionQuota: async () => {
            quota++;
            return { allowed: true, used: quota, limit: 100 };
          },
          recordAuditEvent: async (event: unknown) => {
            audit.push(event);
          },
          findMembership: async (user: string, tenant: string) => {
            const {
              rows: [member],
            } = await pool.query(
              "SELECT role FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
              [tenant, user],
            );
            return member
              ? {
                  tenantId: tenant,
                  tenantName: "Fixture",
                  tenantSlug: "fixture",
                  role: member.role,
                }
              : null;
          },
          compareAnswers: {
            execute: async () => {
              compareCalls++;
              return [0, 1].map(() => ({
                model: model.descriptor,
                providerModel: "fixture/chat",
                prompt: {
                  id: "balanced",
                  label: "Balanced",
                  version: "grounded-v1",
                },
                response: generated,
                error: null,
                latencyMs: 12,
                estimatedCostUsd: 0.0001,
              }));
            },
          },
        } as unknown as Parameters<typeof buildApp>[0]);
        try {
          const cid = randomUUID(),
            headers = {
              authorization: "Bearer member",
              "x-workspace-id": tenantId,
            },
            peer = { ...headers, authorization: "Bearer peer" },
            root = `/v1/conversations/${cid}`;
          assert.equal(
            (await app.inject({ url: "/v1/conversations" })).statusCode,
            401,
          );
          assert.equal(
            (
              await app.inject({
                url: "/v1/conversations",
                headers: { authorization: "Bearer member" },
              })
            ).statusCode,
            400,
          );
          assert.equal(
            (
              await app.inject({
                method: "POST",
                url: "/v1/conversations",
                headers,
                payload: { id: cid, title: "Private project notes" },
              })
            ).statusCode,
            201,
          );
          conversationPageSchema.parse(
            (await app.inject({ url: "/v1/conversations", headers })).json(),
          );
          assert.equal(
            (await app.inject({ url: root + "/messages", headers: peer }))
              .statusCode,
            404,
          );
          assert.equal(
            (
              await app.inject({
                method: "PATCH",
                url: root,
                headers: peer,
                payload: { title: "Stolen" },
              })
            ).statusCode,
            404,
          );
          const runId = randomUUID(),
            payload = {
              conversationId: cid,
              runId,
              question: "Private project question",
              modelId: "default",
            };
          assert.equal(
            (
              await app.inject({
                method: "POST",
                url: "/v1/qa/stream",
                headers,
                payload: { ...payload, modelId: "arbitrary/provider" },
              })
            ).statusCode,
            400,
          );
          assert.equal(
            (
              await app.inject({
                method: "POST",
                url: "/v1/qa/stream",
                headers,
                payload: { ...payload, previousQuestions: ["Forged history"] },
              })
            ).statusCode,
            400,
          );
          const admission = await app.inject({
            method: "POST",
            url: "/v1/qa/stream",
            headers: { ...headers, accept: "application/json" },
            payload,
          });
          assert.equal(admission.statusCode, 202);
          for (
            let n = 0;
            n < 250 &&
            (await repo.turn({ ...scope, conversationId: cid }, runId))
              ?.status !== "completed";
            n++
          )
            await delay(20);
          const first = conversationMessagesSchema.parse(
            (await app.inject({ url: root + "/messages", headers })).json(),
          ).turns[0]!;
          assert.equal(first.status, "completed");
          assert.equal(first.answer?.providerModel, "fixture/chat");
          const replay = await app.inject({
            method: "POST",
            url: "/v1/qa/stream",
            headers,
            payload,
          });
          assert.equal(replay.statusCode, 200);
          assert.match(replay.body, /event: completed/);
          assert.equal(calls, 1);
          assert.equal(quota, 1);
          assert.equal(
            (
              await app.inject({
                method: "POST",
                url: "/v1/qa/stream",
                headers,
                payload: { ...payload, question: "A changed request" },
              })
            ).statusCode,
            409,
          );
          const feedback =
            root + `/messages/${first.assistantMessageId}/feedback`;
          assert.equal(
            (
              await app.inject({
                method: "PUT",
                url: feedback,
                headers: peer,
                payload: { value: "down" },
              })
            ).statusCode,
            404,
          );
          for (let n = 0; n < 2; n++)
            assert.equal(
              (
                await app.inject({
                  method: "PUT",
                  url: feedback,
                  headers,
                  payload: { value: "up" },
                })
              ).statusCode,
              204,
            );
          assert.equal(
            (await repo.turn({ ...scope, conversationId: cid }, runId))
              ?.feedback,
            "up",
          );
          const compareId = randomUUID(),
            comparison = {
              conversationId: cid,
              runId: compareId,
              question: "Compare private notes",
              modelIds: ["default", "default"],
              promptVariantIds: ["balanced", "concise"],
            };
          for (let n = 0; n < 2; n++)
            assert.equal(
              (
                await app.inject({
                  method: "POST",
                  url: "/v1/qa/compare",
                  headers,
                  payload: comparison,
                })
              ).statusCode,
              202,
            );
          for (
            let n = 0;
            n < 250 &&
            (await repo.turn({ ...scope, conversationId: cid }, compareId))
              ?.status !== "completed";
            n++
          )
            await delay(20);
          assert.equal(
            (await repo.turn({ ...scope, conversationId: cid }, compareId))
              ?.comparison?.results.length,
            2,
          );
          assert.equal(compareCalls, 1);
          assert.equal(quota, 2);
          const pendingId = randomUUID();
          await app.inject({
            method: "POST",
            url: "/v1/qa/stream",
            headers: { ...headers, accept: "application/json" },
            payload: {
              conversationId: cid,
              runId: pendingId,
              question: "Wait for deletion",
            },
          });
          for (let n = 0; n < 100 && calls < 2; n++) await delay(10);
          assert.equal(
            (await app.inject({ method: "DELETE", url: root, headers: peer }))
              .statusCode,
            204,
          );
          assert.equal(
            (await repo.messages({ ...scope, conversationId: cid }, 10)).turns
              .length,
            3,
          );
          assert.equal(
            (await app.inject({ method: "DELETE", url: root, headers }))
              .statusCode,
            204,
          );
          for (let n = 0; n < 150 && !aborted; n++) await delay(10);
          assert.equal(aborted, true);
          assert.equal(
            (await app.inject({ url: root + "/messages", headers })).statusCode,
            404,
          );
          const logs = JSON.stringify([
            audit,
            safeHttpLogSerializers.req({
              url: root + "?question=Private project question",
              method: "GET",
            }),
            safeHttpLogSerializers.err(new Error("Private upstream exception")),
          ]);
          for (const secret of [
            "Private project question",
            "Private project notes",
            "Records are kept",
            "Private upstream exception",
          ])
            assert.ok(!logs.includes(secret));
        } finally {
          await app.close();
        }
      },
    );
    await t.test(
      "membership removal deletes private conversations and direct API roles have no table access",
      async () => {
        const memberScope = { tenantId, userId: peerId },
          cid = randomUUID();
        await repo.create(memberScope, cid);
        await pool.query(
          "DELETE FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
          [tenantId, peerId],
        );
        await assert.rejects(
          repo.messages({ ...memberScope, conversationId: cid }, 10),
          ConversationError,
        );
        assert.equal(
          (await pool.query("SELECT 1 FROM conversations WHERE id=$1", [cid]))
            .rowCount,
          0,
        );
        const { rows } = await pool.query(
          "SELECT relname,relrowsecurity AS rls,has_table_privilege('anon',oid,'SELECT') AS anon,has_table_privilege('authenticated',oid,'SELECT') AS authenticated FROM pg_class WHERE oid IN ('conversations'::regclass,'conversation_turns'::regclass)",
        );
        assert.ok(
          rows.every((row) => row.rls && !row.anon && !row.authenticated),
        );
        const functions = await pool.query(
          "SELECT prosecdef,has_function_privilege('anon',oid,'EXECUTE') AS anon FROM pg_proc WHERE oid='sync_conversation_chat_event()'::regprocedure",
        );
        assert.deepEqual(functions.rows, [{ prosecdef: false, anon: false }]);
      },
    );
  },
);
