import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Pool } from "pg";
import type { WorkspaceChatModelPolicy } from "@rag-study/contracts";
import { config } from "../../config.js";
import type { ModelRuntimeIdentity, ModelRuntimeProviders } from "../../modules/ai/index.js";
import type { QuotaRepository } from "../../modules/usage/index.js";
import { createReranker } from "../../modules/ai/ai.module.js";
import { createChatRuntime, createChatStorage } from "../../modules/chat/chat.module.js";
import { createKnowledgeServices } from "../../modules/knowledge/knowledge.module.js";
import { SearchDocumentsUseCase } from "../../modules/knowledge/application/use-cases/search-documents.js";
import { createEvaluationServices } from "../../modules/evaluations/evaluations.module.js";
import { createMcpServices } from "../../modules/mcp/mcp.module.js";
import { createWorkflowRuntime, createWorkspaceWorkflowServices } from "../../modules/workflows/workflows.module.js";

const tenantId = "20000000-0000-4000-8000-000000000001";
const actorKey = "user:fixture";

function fixture(t: TestContext) {
  const pool = new Pool();
  t.mock.method(pool, "connect", () => { throw new Error("Assembly attempted database IO."); });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Assembly attempted provider IO."); });
  t.after(() => pool.end());
  const configuration = {
    ...config, CHAT_PROVIDER: "ollama" as const, OLLAMA_CHAT_MODEL: "fixture-default", LANGSMITH_TRACING: false,
    CHAT_MAX_OUTPUT_TOKENS: 500, RAG_CLAIM_MODE: "extractive" as const,
    CHAT_ADDITIONAL_MODELS: [{ id: "second", label: "Second", model: "fixture-second", provider: "ollama" as const, inputCostPer1kUsd: 0, outputCostPer1kUsd: 0 }],
  };
  const knowledge = createKnowledgeServices(pool, { embeddingDimensions: 1024, uploadBucket: "fixture" });
  const chat = createChatStorage(pool, 1024);
  const embeddings = { embed: async () => { throw new Error("Unexpected embedding"); } };
  const searchDocuments = new SearchDocumentsUseCase(embeddings, knowledge.documents, createReranker({ ...config, RERANKER_PROVIDER: "none" }), {
    defaultTopK: 5, vectorCandidateMultiplier: 4, keywordCandidateMultiplier: 4, reciprocalRankConstant: 60, rerankerCandidateMultiplier: 4, defaultTenantId: tenantId,
  });
  let policy: WorkspaceChatModelPolicy = { allowedModelIds: ["default", "second"], defaultModelId: "default", auto: null };
  const policies = { get: t.mock.fn(async (_tenantId: string) => policy) };
  const requests: Array<ModelRuntimeIdentity & { checkpointKey: string; maxOutputTokens: number }> = [];
  const providers: ModelRuntimeProviders = {
    createAnswer(input) { requests.push(input); return { checkpointKey: input.checkpointKey, generate: async () => { throw new Error("Unexpected generation"); } }; },
    createClaimVerifier: () => ({ requiresExtractiveAnswer: true, verify: async () => ({ method: "extractive", supported: true, claims: 0, unsupported: 0 }) }),
    createEvaluationJudge: () => ({ model: "fixture-judge", assess: async () => { throw new Error("Unexpected judge call"); } }),
  };
  const consumeQuestion = t.mock.fn<QuotaRepository["consumeQuestion"]>(async () => ({ allowed: true, used: 1, limit: 10 }));
  const runtime = createChatRuntime({
    embeddings, searchDocuments, semanticCache: chat.semanticCache,
    usageMetrics: { record: async () => {}, summarize: async () => { throw new Error("Unexpected ledger query"); } },
    workspaceModelPolicies: policies, chatRuns: chat.chatRuns, quota: { consumeQuestion }, aiProviders: providers, configuration,
  });
  return { pool, configuration, knowledge, chat, embeddings, searchDocuments, policies, providers, requests, consumeQuestion, runtime, setPolicy: (value: WorkspaceChatModelPolicy) => { policy = value; } };
}

test("chat assembly rechecks workspace policies and preserves evaluation caps, cache signatures and quota receipts", async (t) => {
  const f = fixture(t);
  const original = await f.runtime.bindings.resolveChat(tenantId);
  assert.equal(original?.modelId, "default");
  assert.equal((await f.runtime.bindings.resolveChat(tenantId))?.signature, original?.signature);
  f.setPolicy({ allowedModelIds: ["second"], defaultModelId: "second", auto: null });
  const switched = await f.runtime.bindings.resolveChat(tenantId);
  assert.equal(switched?.modelId, "second"); assert.notEqual(switched?.signature, original?.signature);
  assert.equal(await f.runtime.bindings.resolveChat(tenantId, "default"), null);
  const evaluated = await f.runtime.bindings.resolveEvaluationModel(tenantId, undefined, 9999);
  assert.equal(evaluated?.model, "fixture-second"); assert.equal(evaluated?.maxOutputTokens, 500);
  assert.equal(f.requests.at(-1)?.checkpointKey, "evaluation:default:500");
  f.setPolicy({ allowedModelIds: ["default", "second"], defaultModelId: "default", auto: { simpleModelId: "default", complexModelId: "second", fallbackModelIds: ["second"] } });
  t.mock.method(f.runtime.routeAnswer, "execute", async (input: Parameters<typeof f.runtime.routeAnswer.execute>[0]) => { await input.reserveFallbackQuota("second"); return { answer: "Fixture", sources: [] }; });
  const automatic = await f.runtime.bindings.resolveChat(tenantId, "auto");
  assert.ok(automatic);
  await automatic.execute({ tenantId, actorKey, question: "Fixture?" });
  await f.runtime.bindings.consumeQuota(tenantId, actorKey);
  assert.deepEqual(f.consumeQuestion.mock.calls.map((call) => call.arguments[0].receiptKey), ["fallback:second", "primary"]);
  assert.ok(f.policies.get.mock.callCount() >= 6);
  assert.equal(f.pool.totalCount, 0);
});

test("MCP assembly keeps actions independent and shares controls without eagerly resolving a disabled read index", (t) => {
  const f = fixture(t);
  const configuration = { ...config, MCP_REMOTE_ENABLED: true, MCP_PUBLIC_URL: "https://api.example.test/mcp", APP_BASE_URL: "https://app.example.test", AGENT_ACTIONS_ENABLED: true };
  const disabled = createMcpServices({ pool: f.pool, readPool: null, measuredEmbeddings: () => f.embeddings, defaultEmbeddingIdentity: () => { throw new Error("Disabled reads resolved an index."); }, configuration });
  assert.equal(disabled.workspaceMcp, undefined); assert.equal(disabled.remoteMcp, undefined); assert.ok(disabled.agentActions);
  const enabled = createMcpServices({ pool: f.pool, readPool: f.pool, measuredEmbeddings: () => f.embeddings, defaultEmbeddingIdentity: () => ({ provider: "ollama", model: "fixture-embedding", dimensions: 1024 }), configuration });
  assert.ok(enabled.workspaceMcp); assert.ok(enabled.remoteMcp);
  assert.equal(enabled.workspaceMcp.tools, enabled.remoteMcp.tools);
  assert.equal(enabled.workspaceMcp.controls, enabled.remoteMcp.controls);
  assert.equal(f.pool.totalCount, 0);
});

test("evaluation and workflow assembly share bindings and runtime without starting background work", async (t) => {
  const f = fixture(t);
  const engine = createWorkflowRuntime(f.pool, { WORKFLOWS_ENABLED: true, WORKFLOW_STATE_KEY: Buffer.alloc(32, 7).toString("base64") }, () => { throw new Error("Unexpected workflow failure"); });
  assert.ok(engine);
  const register = t.mock.method(engine, "register");
  const evaluation = createEvaluationServices({
    pool: f.pool, searchDocuments: f.searchDocuments,
    models: { embeddingProvider: "ollama", embeddingModel: "fixture-embedding", chatProvider: "ollama", chatModel: f.runtime.defaultModel },
    aiProviders: f.providers, chatBindings: f.runtime.bindings,
    embeddingIdentity: async () => ({ provider: "ollama", model: "fixture-embedding", version: "fixture-index" }),
    demoLibraryRepository: { sourceStates: async () => [{ source: "golden/rag-fundamentals", state: "ready", documentId: null, jobId: null }] }, durable: true,
  });
  assert.equal(evaluation.runEvaluation.supportsFaithfulness, true);
  await evaluation.runEvaluation.preflight({ tenantId, includeFaithfulness: true, modelId: "second" });
  f.setPolicy({ allowedModelIds: ["default"], defaultModelId: "default", auto: null });
  await assert.rejects(evaluation.runEvaluation.preflight({ tenantId, includeFaithfulness: true, modelId: "second" }), (error) => error instanceof Error && error.message === "Select an available evaluation model.");
  const workflows = createWorkspaceWorkflowServices({ engine, chat: f.runtime.bindings, runEvaluation: evaluation.runEvaluation, evaluationVersion: evaluation.evaluationVersion, member: async () => null, embeddingVersion: async () => "fixture-index", configuration: f.configuration });
  assert.ok(workflows);
  assert.deepEqual(register.mock.calls.map((call) => [call.arguments[0], call.arguments[1].version]), [["chat", "chat-v2"], ["evaluation", "evaluation-v2"]]);
  const close = t.mock.method(engine, "close");
  const first = workflows.close(); assert.equal(workflows.close(), first); await first;
  assert.equal(close.mock.callCount(), 1); assert.equal(f.pool.totalCount, 0);
});
