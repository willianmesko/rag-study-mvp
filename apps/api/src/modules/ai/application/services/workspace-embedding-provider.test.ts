import assert from "node:assert/strict";
import test from "node:test";
import type { EmbeddingModelIdentity, WorkspaceEmbeddingVersion } from "../ports/workspace-embedding-index.js";
import { createWorkspaceEmbeddingAdapter, createWorkspaceEmbeddingProvider } from "./workspace-embedding-provider.js";

const initial: EmbeddingModelIdentity = { provider: "ollama", model: "fixture/default", dimensions: 1024 };
const vector = () => Array.from({ length: 1024 }, (_, index) => Number(index === 0));

test("the direct embedding boundary used by workspace and MCP paths redacts PII and preserves native usage", async () => {
  const inputs: unknown[] = [];
  const usage: unknown[] = [];
  const controller = new AbortController();
  const adapter = createWorkspaceEmbeddingAdapter(initial, {
    createEmbedding(identity) {
      assert.deepEqual(identity, initial);
      return { async embed(text, inputType, signal, onUsage) {
        inputs.push({ text, inputType, signal });
        onUsage?.({ inputTokens: 5, outputTokens: 0 });
        return vector();
      } };
    },
  });
  await adapter.embed("Contact person@example.test", "query", controller.signal, (value) => usage.push(value));
  assert.deepEqual(inputs, [{ text: "Contact [REDACTED_EMAIL]", inputType: "query", signal: controller.signal }]);
  assert.deepEqual(usage, [{ inputTokens: 5, outputTokens: 0 }]);
  for (const invalid of [[1], Array.from({ length: 1024 }, () => 0), vector().map((value, index) => index === 1 ? Number.NaN : value)]) {
    const malformed = createWorkspaceEmbeddingAdapter(initial, { createEmbedding: () => ({ embed: async () => invalid }) });
    await assert.rejects(malformed.embed("Document", "document"), /dimensions|finite, nonzero/);
  }
});

test("workspace adapters use the resolved index version, require scope, and stop before constructing cancelled work", async () => {
  let pins = 0, factories = 0;
  const active: WorkspaceEmbeddingVersion = { ...initial, model: "fixture/pinned", id: "index", revision: "revision-2", state: "active" };
  const provider = createWorkspaceEmbeddingProvider({
    async getOrPinActive(tenantId, identity, signal) {
      pins++;
      assert.equal(tenantId, "workspace");
      assert.deepEqual(identity, initial);
      assert.ok(signal);
      return active;
    },
  }, initial, (identity, tenantId) => {
    factories++;
    assert.deepEqual(identity, active);
    assert.equal(tenantId, "workspace");
    return { embed: async () => vector() };
  });
  await assert.rejects(provider.embed("No workspace", "query"), /Workspace scope/);
  const resolved = await provider.forWorkspace!("workspace", AbortSignal.timeout(1_000));
  assert.equal(resolved.version, active.revision);
  assert.deepEqual(resolved.identity, active);
  assert.equal((await resolved.provider.embed("Document", "document")).length, 1024);
  const stop = new AbortController();
  stop.abort(new Error("fixture stop"));
  await assert.rejects(provider.forWorkspace!("workspace", stop.signal), (error: unknown) => error === stop.signal.reason);
  assert.equal(pins, 1);
  assert.equal(factories, 1);
  const stopDuringPin = new AbortController();
  const stoppedDuringPin = createWorkspaceEmbeddingProvider({
    async getOrPinActive() { stopDuringPin.abort(new Error("stopped during pin")); return active; },
  }, initial, () => { throw new Error("Cancelled resolution constructed a provider"); });
  await assert.rejects(stoppedDuringPin.forWorkspace!("workspace", stopDuringPin.signal), (error: unknown) => error === stopDuringPin.signal.reason);
});
