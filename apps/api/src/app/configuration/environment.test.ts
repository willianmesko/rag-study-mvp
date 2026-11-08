import assert from "node:assert/strict";
import test from "node:test";
import { parseRuntimeConfiguration } from "./environment.js";

test("isolated configuration parsing applies existing defaults without shared mutable state", () => {
  const input = Object.freeze({ ALLOWED_ORIGINS: "https://first.example, https://second.example", PORT: "4100" });
  const first = parseRuntimeConfiguration(input), second = parseRuntimeConfiguration({});
  assert.equal(first.PORT, 4100);
  assert.equal(second.PORT, 3000);
  assert.equal(second.EMBEDDING_DIMENSIONS, 1024);
  assert.equal(second.EMBEDDING_PROVIDER, "ollama");
  assert.deepEqual(first.ALLOWED_ORIGINS, ["https://first.example", "https://second.example"]);
  assert.deepEqual(second.ALLOWED_ORIGINS, []);
  first.ALLOWED_ORIGINS.push("https://later.example");
  first.CHAT_ADDITIONAL_MODELS.push({ id: "example", label: "Example", model: "example/model", inputCostPer1kUsd: 0, outputCostPer1kUsd: 0 });
  assert.deepEqual(second.CHAT_ADDITIONAL_MODELS, []);
  assert.deepEqual(second.ALLOWED_ORIGINS, []);
  assert.deepEqual(input, { ALLOWED_ORIGINS: "https://first.example, https://second.example", PORT: "4100" });
});

test("configuration preserves cross-field guards before any adapter can be constructed", () => {
  const cases: Array<[Record<string, string>, RegExp]> = [
    [{ CHUNK_SIZE: "200", CHUNK_OVERLAP: "200" }, /CHUNK_OVERLAP/],
    [{ EMBEDDING_DIMENSIONS: "1536" }, /vector\(1024\)/],
    [{ CHAT_PROVIDER: "openrouter" }, /OPENROUTER_API_KEY/],
    [{ RERANKER_PROVIDER: "jina" }, /JINA_API_KEY/],
    [{ LUMORA_LANGSMITH_TRACING: "true" }, /LANGSMITH_API_KEY/],
    ...["LANGSMITH_TRACING", "LANGCHAIN_TRACING_V2", "LANGCHAIN_TRACING"].map((key): [Record<string, string>, RegExp] => [{ [key]: "true", LANGSMITH_API_KEY: "fixture-only" }, /Automatic LangChain tracing is prohibited/]),
    [{ DEMO_MODE: "true" }, /ADMIN_API_KEY/],
    [{ WORKFLOWS_ENABLED: "true" }, /WORKFLOW_STATE_KEY/],
    [{ MCP_REMOTE_ENABLED: "true" }, /Remote MCP requires/],
    [{ MCP_ENABLED: "true" }, /Supabase Auth/],
    [{ SUPABASE_URL: "https://auth.example.test" }, /configured together/],
    [{ DEMO_MODE: "true", ADMIN_API_KEY: "synthetic-admin-key", API_KEY: "synthetic-global-key" }, /cannot be combined/],
  ];
  for (const [input, expected] of cases) assert.throws(() => parseRuntimeConfiguration(input), expected);
  for (const input of [{ RATE_LIMIT_MAX: "NaN" }, { PDF_OCR_MAX_PAGES: "21" }, { CHAT_ADDITIONAL_MODELS: "not-json" }, { PROVIDER_TIMEOUT_MS: "0" }])
    assert.throws(() => parseRuntimeConfiguration(input));
});

test("independent parsed configurations retain backend model policies and workflow key inputs", () => {
  const first = parseRuntimeConfiguration({
    CHAT_PROVIDER: "openrouter", OPENROUTER_API_KEY: "synthetic-provider-key",
    CHAT_ADDITIONAL_MODELS: JSON.stringify([{ id: "alternate", label: "Alternate", model: "example/model", inputCostPer1kUsd: 0.001, outputCostPer1kUsd: 0.002 }]),
    WORKFLOWS_ENABLED: "true", WORKFLOW_STATE_KEY: Buffer.alloc(32, 1).toString("base64"),
  });
  const second = parseRuntimeConfiguration({ CHAT_PROVIDER: "ollama" });
  assert.equal(first.CHAT_ADDITIONAL_MODELS[0]?.id, "alternate");
  assert.equal(first.WORKFLOWS_ENABLED, true);
  assert.equal(second.WORKFLOWS_ENABLED, false);
  assert.equal(second.OPENROUTER_API_KEY, undefined);
  assert.throws(() => parseRuntimeConfiguration({ CHAT_ADDITIONAL_MODELS: JSON.stringify([
    { id: "same", label: "A", model: "example/a", inputCostPer1kUsd: 0, outputCostPer1kUsd: 0 },
    { id: "same", label: "B", model: "example/b", inputCostPer1kUsd: 0, outputCostPer1kUsd: 0 },
  ]) }));
});

test("safe summary activation does not enable vendor automatic callbacks", () => {
  const config = parseRuntimeConfiguration({ LUMORA_LANGSMITH_TRACING: "true", LANGSMITH_API_KEY: "fixture-only" });
  assert.equal(config.LUMORA_LANGSMITH_TRACING, true);
  assert.equal(config.LANGSMITH_TRACING, false);
  assert.equal(config.LANGCHAIN_TRACING_V2, false);
  assert.equal(config.LANGCHAIN_TRACING, false);
});
