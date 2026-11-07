import {IntegrationFailure} from '../../application/integrations/retry-policy.js';
import { LangGraphIngestionWorkflow } from "./langgraph-ingestion-workflow.js";
import { LangGraphEvaluationWorkflow } from "./langgraph-evaluation-workflow.js";
import { RunEvaluationUseCase } from "../../application/use-cases/run-evaluation.js";
import { IngestDocumentUseCase } from "../../application/use-cases/ingest-document.js";
import { PgDocumentRepository } from "../postgres/pg-document-repository.js";
import { PgIngestionJobRepository } from "../postgres/pg-ingestion-job-repository.js";
import { PgEvaluationRepository } from "../postgres/pg-evaluation-repository.js";
import { judgeCalibrationCases } from "../../application/evaluation/judge-calibration-cases.js";
import { reviewedPassages } from "../../application/evaluation/context-precision.js";
import { dashboardGoldenSet } from "../../application/evaluation/default-evaluation-suites.js";
import type { FaithfulnessJudge } from "../../application/evaluation/public-faithfulness.js";
import type { SemanticAnswerCache } from "../../application/ports/semantic-answer-cache.js";
import { PgQuotaRepository } from "../postgres/pg-quota-repository.js";
import { PgChatRunRepository } from "../postgres/pg-chat-run-repository.js";
import { LangGraphChatWorkflow } from "./langgraph-chat-workflow.js";
import { DurableWorkflowRunner } from "./durable-workflow-runner.js";
import { WorkflowEmbeddingProvider } from "../security/workflow-provider-guards.js";
import type { ChatRunEvent, QuestionResponse } from "@rag-study/contracts";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import {
  Annotation,
  END,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import {
  withExecution,
  workflowNode,
  workflowEffect,
} from "../../application/workflows/execution-context.js";
import type {
  WorkflowBudget,
  WorkflowLease,
} from "../../application/workflows/types.js";
import { PgWorkflowRepository } from "../postgres/pg-workflow-repository.js";
import { WorkflowStateCodec } from "../security/workflow-state-codec.js";
import { PgWorkflowCheckpointer } from "./pg-workflow-checkpointer.js";
import { graphExecution, withGraphPersistence } from "./graph-execution.js";

const url = process.env.MCP_TEST_DATABASE_URL;
const budget: WorkflowBudget = {
  maxSteps: 40,
  maxCalls: 20,
  maxInputTokens: 100_000,
  maxOutputTokens: 8_000,
  maxCostMicros: 50_000,
  timeoutMs: 60_000,
};
test(
  "native LangGraph checkpoints recover private scoped work and durable approval",
  { skip: !url, timeout: 30_000 },
  async (t) => {
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url!).hostname),
      "Use a disposable local database.",
    );
    const pool = new Pool({ connectionString: url, max: 5 });
    const codec = new WorkflowStateCodec(randomBytes(32).toString("base64"));
    const repo = new PgWorkflowRepository(pool, codec);
    const tenantId = randomUUID(),
      userId = randomUUID();
    await pool.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,$3)", [
      tenantId,
      `workflow-${tenantId}`,
      "Workflow fixture",
    ]);
    await pool.query(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [tenantId, userId],
    );
    t.after(async () => {
      try {
        await pool.query("DELETE FROM ingestion_jobs WHERE tenant_id=$1", [
          tenantId,
        ]);
        await pool.query("DELETE FROM documents WHERE tenant_id=$1", [
          tenantId,
        ]);
        await pool.query("DELETE FROM tenants WHERE id=$1", [tenantId]);
      } finally {
        await pool.end();
      }
    });
    const run = <T>(lease: WorkflowLease, work: () => Promise<T>) =>
      withExecution(
        {
          lease,
          repository: repo,
          signal: new AbortController().signal,
          authorize: async () => true,
          node: "fixture",
          effects: new Map(),
          publications: { next: 0 },
        },
        () =>
          withGraphPersistence(
            {
              runId: lease.runId,
              approved: lease.approvedBy !== null,
              createSaver: (graph) =>
                new PgWorkflowCheckpointer(repo, lease, graph),
            },
            work,
          ),
      );

    await t.test(
      "a new process resumes only the failed node and keeps completed provider results",
      async () => {
        const scope = { tenantId, actorId: "ingestion", runId: randomUUID() };
        await pool.query(
          "INSERT INTO ingestion_jobs(id,tenant_id,source,filename,mime_type,payload,status) VALUES($1,$2,'fixture','fixture.md','text/markdown',$3,'processing')",
          [scope.runId, tenantId, Buffer.from("Private source passage.")],
        );
        await repo.admit({
          ...scope,
          kind: "ingestion",
          version: "fixture-v1",
          input: { jobId: scope.runId },
          budget,
        });
        let first = 0,
          second = 0,
          provider = 0,
          fail = true;
        const State = Annotation.Root({
          sources: Annotation<Map<string, string>>,
          result: Annotation<string>,
        });
        const invoke = async () => {
          const execution = graphExecution("fixture-v1")!;
          const graph = new StateGraph(State)
            .addNode("first", () =>
              workflowNode("first", async () => {
                first++;
                const value = await workflowEffect(
                  "provider",
                  { query: "private fixture question" },
                  { calls: 1, inputTokens: 5 },
                  async () => {
                    provider++;
                    return "Private source passage.";
                  },
                );
                return { sources: new Map([["S1", value]]) };
              }),
            )
            .addNode("second", (state) =>
              workflowNode("second", async () => {
                second++;
                if (fail)
                  throw new Error("Expected transient fixture failure.");
                return { result: state.sources.get("S1")! };
              }),
            )
            .addEdge(START, "first")
            .addEdge("first", "second")
            .addEdge("second", END)
            .compile({ checkpointer: execution.saver });
          const input = await execution.input({}, () =>
            graph.getState(execution.config),
          );
          return graph.invoke(input, execution.config);
        };
        const firstLease = (await repo.claim(["ingestion"]))!;
        await assert.rejects(run(firstLease, invoke), /Expected transient/);
        await repo.release(firstLease);
        fail = false;
        const next = (await new PgWorkflowRepository(pool, codec).claim([
          "ingestion",
        ]))!;
        const result = await run(next, invoke);
        assert.equal(result.result, "Private source passage.");
        assert.equal(first, 1);
        assert.equal(second, 2);
        assert.equal(provider, 1);
        const snapshot = await repo.get(scope);
        assert.equal(snapshot?.calls, 1);
        const {
          rows: [bytes],
        } = await pool.query<{ plain: boolean }>(
          "SELECT bool_or(position(convert_to('Private source passage.','UTF8') in cipher)>0) AS plain FROM workflow_checkpoints WHERE tenant_id=$1",
          [tenantId],
        );
        assert.equal(bytes.plain, false);
        await assert.rejects(
          new PgWorkflowCheckpointer(repo, next, "fixture-v1").getTuple({
            configurable: { thread_id: "another-run" },
          }),
          /authorization_revoked/,
        );
        await repo.finish(next, "completed");
      },
    );

    await t.test(
      "an interrupt survives a worker change and requires a current owner approval",
      async () => {
        const scope = { tenantId, actorId: userId, runId: randomUUID() };
        await repo.admit({
          ...scope,
          kind: "evaluation",
          version: "approval-v1",
          input: { action: "run_evaluation" },
          budget,
        });
        let effects = 0;
        const State = Annotation.Root({ done: Annotation<boolean> });
        const invoke = async () => {
          const execution = graphExecution("approval-v1")!;
          const graph = new StateGraph(State)
            .addNode("approval", () =>
              workflowNode("approval", async () => {
                const choice = interrupt<unknown, { approved: boolean }>({
                  action: "run_evaluation",
                });
                if (!choice.approved) throw new Error("Approval denied.");
                return {};
              }),
            )
            .addNode("effect", () =>
              workflowNode("effect", async () => {
                effects++;
                return { done: true };
              }),
            )
            .addEdge(START, "approval")
            .addEdge("approval", "effect")
            .addEdge("effect", END)
            .compile({ checkpointer: execution.saver });
          const input = await execution.input({}, () =>
            graph.getState(execution.config),
          );
          return graph.invoke(input, execution.config);
        };
        const lease = (await repo.claim(["evaluation"]))!;
        const paused = await run(lease, invoke);
        assert.equal(paused.done, undefined);
        assert.equal(effects, 0);
        await repo.finish(lease, "waiting_approval");
        assert.equal(await repo.approve(scope, randomUUID()), false);
        assert.equal(await repo.approve(scope, userId), true);
        const next = (await repo.claim(["evaluation"]))!;
        const result = await run(next, invoke);
        assert.equal(result.done, true);
        assert.equal(effects, 1);
        await repo.finish(next, "completed");
      },
    );
    await t.test(
      "chat resumes publication without repeating quota, generation or status events",
      async () => {
        const scope = { tenantId, actorId: userId, runId: randomUUID() },
          documentId = randomUUID(),
          chunkId = randomUUID();
        await pool.query(
          "INSERT INTO documents(id,tenant_id,source) VALUES($1,$2,$3)",
          [documentId, tenantId, `fixture/${documentId}`],
        );
        await pool.query(
          "INSERT INTO chunks(id,document_id,ordinal,content,embedding) VALUES($1,$2,0,'A grounded fixture passage.',$3::vector)",
          [
            chunkId,
            documentId,
            JSON.stringify(
              Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)),
            ),
          ],
        );
        await repo.admit({
          ...scope,
          kind: "chat",
          version: "chat-fixture",
          input: { question: "What is the policy?" },
          budget,
        });
        const chats = new PgChatRunRepository(pool),
          quota = new PgQuotaRepository(pool);
        let generated = 0,
          fail = true;
        const original = chats.append.bind(chats);
        chats.append = async (...args) => {
          if (fail && args[1].some((event) => event.type === "completed")) {
            fail = false;
            throw new Error("Fixture publish failure");
          }
          return original(...args);
        };
        const response: QuestionResponse = {
          answer: "A grounded fixture passage.",
          citedChunkIds: [chunkId],
          structuredOutput: true,
          sources: [
            {
              chunkId,
              documentId,
              source: `fixture/${documentId}`,
              title: null,
              chunk: 0,
              score: 0.9,
              excerpt: "A grounded fixture passage.",
              excerptTruncated: false,
            },
          ],
          contextSources: [],
          cacheHit: false,
        };
        const work = {
          reserveQuota: async () =>
            (
              await quota.consumeQuestion({
                tenantId,
                actorKey: `user:${userId}`,
                tenantLimit: 100,
                actorLimit: 100,
                receiptKey: "primary",
              })
            ).allowed,
          answer: async (
            _signal: AbortSignal,
            publish: (event: ChatRunEvent) => Promise<void>,
          ) => {
            generated++;
            await publish({ type: "retrieving" });
            await publish({ type: "generating" });
            await publish({ type: "validating" });
            return response;
          },
        };
        const first = (await repo.claim(["chat"]))!;
        await assert.rejects(
          run(first, () =>
            new LangGraphChatWorkflow(chats).execute(
              scope,
              work,
              new AbortController().signal,
            ),
          ),
          /Fixture publish failure/,
        );
        await repo.release(first);
        const next = (await repo.claim(["chat"]))!;
        await run(next, () =>
          new LangGraphChatWorkflow(chats).execute(
            scope,
            work,
            new AbortController().signal,
          ),
        );
        await repo.finish(next, "completed");
        assert.equal(generated, 1);
        const replay = await chats.read(scope, 0);
        assert.equal(replay?.status, "completed");
        assert.deepEqual(
          replay?.events.map(({ event }) => event.type),
          [
            "accepted",
            "retrieving",
            "generating",
            "validating",
            "citations",
            "token",
            "completed",
          ],
        );
        const usage = await pool.query(
          "SELECT qa_requests FROM tenant_daily_usage WHERE tenant_id=$1 AND actor_key=$2",
          [tenantId, `user:${userId}`],
        );
        assert.equal(usage.rows[0]?.qa_requests, 1);
      },
    );
    await t.test(
      "source deletion stops stale answer publication and old leases cannot reserve more calls",
      async () => {
        const scope = { tenantId, actorId: userId, runId: randomUUID() };
        await repo.admit({
          ...scope,
          kind: "chat",
          version: "fixture",
          input: {},
          budget,
        });
        const first = (await repo.claim(["chat"]))!;
        await repo.release(first);
        const next = (await repo.claim(["chat"]))!;
        await assert.rejects(
          repo.effect(first, "old-lease", { calls: 1 }, async () => {
            throw new Error("Must not call provider");
          }),
          /lease_lost/,
        );
        const chats = new PgChatRunRepository(pool),
          missing = randomUUID();
        await assert.rejects(
          run(next, () =>
            new LangGraphChatWorkflow(chats).execute(
              scope,
              {
                reserveQuota: async () => true,
                answer: async () => ({
                  answer: "Old answer",
                  structuredOutput: true,
                  citedChunkIds: [missing],
                  sources: [
                    {
                      chunkId: missing,
                      documentId: randomUUID(),
                      source: "deleted",
                      title: null,
                      chunk: 0,
                      score: 0.9,
                      excerpt: "Deleted passage",
                      excerptTruncated: false,
                    },
                  ],
                  contextSources: [],
                }),
              },
              new AbortController().signal,
            ),
          ),
          /definition_changed/,
        );
        const replay = await chats.read(scope, 0);
        assert.ok(
          !replay?.events.some(
            ({ event }) => event.type === "token" || event.type === "citations",
          ),
        );
        await repo.finish(next, "failed", undefined, "definition_changed");
      },
    );
    await t.test(
      "cancelling a running workflow stops the provider and prevents all late effects",
      async () => {
        const scope = { tenantId, actorId: userId, runId: randomUUID() };
        let started!: () => void,
          stopped = false;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        const provider = new WorkflowEmbeddingProvider(
          {
            embed: async (_text, _type, signal) =>
              new Promise<number[]>((_, reject) => {
                signal!.addEventListener(
                  "abort",
                  () => {
                    stopped = true;
                    reject(signal!.reason);
                  },
                  { once: true },
                );
                started();
              }),
          },
          "fixture",
          2,
          0,
        );
        const engine = new DurableWorkflowRunner(
          repo,
          (lease, graph) => new PgWorkflowCheckpointer(repo, lease, graph),
        );
        engine.register("chat", {
          version: "cancel-v1",
          authorize: async () => true,
          run: async (_lease, signal) => {
            await workflowNode("provider", () =>
              provider.embed("private question", "query", signal),
            );
            return {};
          },
        });
        engine.start();
        try {
          await engine.submit({
            ...scope,
            kind: "chat",
            version: "cancel-v1",
            input: {},
            budget,
          });
          await ready;
          assert.equal(await engine.cancel(scope), true);
        } finally {
          await engine.close();
        }
        assert.equal(stopped, true);
        assert.equal((await repo.get(scope))?.status, "cancelled");
        assert.equal(
          (await new PgChatRunRepository(pool).read(scope, 0))?.events.at(-1)
            ?.event.type,
          "cancelled",
        );
      },
    );

    await t.test(
      "real ingestion graph resumes embedding without extracting or paying for completed vectors again",
      async () => {
        const jobs = new PgIngestionJobRepository(pool),
          documents = new PgDocumentRepository(pool, 1024);
        const text =
          "First passage about retention and archives. ".repeat(5) +
          "\n\nSecond passage about procedures and policies. ".repeat(5);
        const job = await jobs.enqueue({
          tenantId,
          source: `fixture/ingest-${randomUUID()}`,
          title: "Safe fixture",
          filename: "fixture.md",
          mimeType: "text/markdown",
          payload: Buffer.from(text),
          storagePath: null,
        });
        await pool.query(
          "UPDATE ingestion_jobs SET status='processing' WHERE id=$1",
          [job.id],
        );
        const scope = { tenantId, actorId: "ingestion", runId: job.id };
        await repo.admit({
          ...scope,
          kind: "ingestion",
          version: "ingest-fixture",
          input: { jobId: job.id },
          budget,
        });
        let extracted = 0,
          calls = 0,
          fail = true;
        const embeddedTexts: string[] = [];
        const provider = new WorkflowEmbeddingProvider(
          {
            embed: async (text) => {
              embeddedTexts.push(text);
              calls++;
              if (calls === 2 && fail)
                throw new IntegrationFailure('rate_limited',429);
              return Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
            },
          },
          "fixture",
          1024,
          0,
        );
        const cache = {
          invalidateTenant: async () => {},
        } as unknown as SemanticAnswerCache;
        const graph = () =>
          new LangGraphIngestionWorkflow(
            jobs,
            {
              extract: async () => {
                extracted++;
                return {
                  text,
                  title: "Safe fixture",
                  metadata: { format: "markdown" },
                };
              },
            },
            new IngestDocumentUseCase(provider, documents, {
              chunkSize: 120,
              chunkOverlap: 10,
              embeddingConcurrency: 1,
            }),
            { get: async () => Buffer.from(text) } as never,
            cache,
          );
        const lease = (await repo.claim(["ingestion"]))!;
        await assert.rejects(
          run(lease, () => graph().execute(job, new AbortController().signal)),
          /rate_limited/,
        );
        await repo.release(lease);
        fail = false;
        const next = (await repo.claim(["ingestion"]))!;
        const result = await run(next, () =>
          graph().execute(job, new AbortController().signal),
        );
        await repo.finish(next, "completed", result.id);
        assert.equal(extracted, 1);
        assert.equal(calls, new Set(embeddedTexts).size + 1);
        assert.equal(
          embeddedTexts.filter((text) => text === embeddedTexts[0]).length,
          1,
        );
        assert.equal(
          (await jobs.readForProcessing(job.id, tenantId))?.status,
          "completed",
        );
        const events = await jobs.listEvents(job.id, tenantId, 100);
        assert.equal(
          events.filter(
            (event) =>
              event.stage === "text_extraction" && event.status === "completed",
          ).length,
          1,
        );
        assert.equal(
          events.filter(
            (event) => event.stage === "embedding" && event.status === "failed",
          ).length,
          1,
        );
        const fresh = await jobs.requeueDocument(result.id, tenantId);
        assert.ok(fresh);
        assert.notEqual(fresh.id, job.id);
        await jobs.cancel(fresh.id, tenantId);
      },
    );
    await t.test(
      "the evaluation graph pauses before providers, resumes after owner approval and saves one versioned report",
      async () => {
        const scope = { tenantId, actorId: userId, runId: randomUUID() };
        await repo.admit({
          ...scope,
          kind: "evaluation",
          version: "evaluation-fixture",
          input: {},
          budget,
        });
        let judged = 0,
          generated = 0;
        const judge: FaithfulnessJudge = {
          model: "fixture-judge",
          assess: async (input) => {
            judged++;
            const calibration = judgeCalibrationCases.find(
              (item) => item.answer === input.answer,
            );
            return calibration
              ? calibration.expected.map(({ claim, support }) => ({
                  claim,
                  evidence: support,
                }))
              : [{ claim: input.answer, evidence: input.passages[0]! }];
          },
        };
        const search = {
          execute: async ({ query }: { query: string }) => {
            const item = dashboardGoldenSet.cases.find(
              (item) => item.question === query,
            )!;
            return [
              {
                chunkId: randomUUID(),
                documentId: randomUUID(),
                ordinal: 0,
                source: "golden/rag-fundamentals",
                title: null,
                score: 1,
                content:
                  reviewedPassages[item.id as keyof typeof reviewedPassages]
                    .content,
                security: { promptInjectionRisk: "low" as const, signals: [] },
              },
            ];
          },
        };
        const identity = {
          embeddingProvider: "fixture",
          embeddingModel: "fixture",
          chatProvider: "fixture",
          chatModel: "fixture",
        };
        const evaluations = new PgEvaluationRepository(pool);
        const make = () =>
          new RunEvaluationUseCase(
            search,
            evaluations,
            identity,
            {
              judge,
              resolveModel: () => ({
                provider: "fixture",
                model: "fixture-answer",
                inputCostPer1kUsd: 0,
                outputCostPer1kUsd: 0,
                maxOutputTokens: 320,
                generator: {
                  generate: async (_q, context) => {
                    generated++;
                    const answer = context.split(">\n")[1]!.split("\n</")[0]!;
                    return JSON.stringify({ answer, citedChunkIds: ["S1"] });
                  },
                },
              }),
            },
            undefined,
            async () => true,
            new LangGraphEvaluationWorkflow(search, evaluations, identity),
          );
        const first = (await repo.claim(["evaluation"]))!;
        await assert.rejects(
          run(first, () =>
            make().execute({
              tenantId,
              includeFaithfulness: true,
              modelId: "default",
            }),
          ),
          /waiting for owner approval/,
        );
        assert.equal(judged, 0);
        assert.equal(generated, 0);
        await repo.finish(first, "waiting_approval");
        assert.equal(await repo.approve(scope, userId), true);
        const next = (await repo.claim(["evaluation"]))!;
        const report = await run(next, () =>
          make().execute({
            tenantId,
            includeFaithfulness: true,
            modelId: "default",
          }),
        );
        assert.equal(report.faithfulness, 1);
        assert.equal(report.contextPrecision, 1);
        assert.equal(report.passed, true);
        assert.equal(
          report.failureDetails.workflow &&
            (report.failureDetails.workflow as { reportVersion: string })
              .reportVersion,
          "2.0",
        );
        const replay = await run(next, () =>
          make().execute({
            tenantId,
            includeFaithfulness: true,
            modelId: "default",
          }),
        );
        assert.equal(replay.id, report.id);
        assert.equal(generated, 4);
        assert.equal(judged, 7);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM evaluation_runs WHERE tenant_id=$1 AND workflow_run_id=$2",
              [tenantId, scope.runId],
            )
          ).rows[0]?.n,
          1,
        );
        await repo.finish(next, "completed", report.id);
      },
    );
  },
);
