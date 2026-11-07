import assert from "node:assert/strict";
import test from "node:test";
import { ProviderMeasurements } from "./measured-providers.js";
import {
  withProviderReceipt,
  withProviderUsageScope,
} from "../../../../platform/observability/provider-usage-context.js";
import type { UsageMetricsRepository } from "../../application/ports/usage-metrics-repository.js";

test("native usage, real zero costs, unknown prices and invalid metadata stay distinct", async () => {
  const records: Parameters<UsageMetricsRepository["record"]>[0][] = [];
  const measured = new ProviderMeasurements({
    record: async (value) => {
      records.push(value);
    },
    summarize: async () => {
      throw new Error("unused");
    },
  });
  const identity = {
    provider: "openrouter",
    model: "embedding-fixture",
    dimensions: 2,
  } as const;
  await withProviderUsageScope(
    { tenantId: "workspace-a", actorKey: "private-user" },
    async () => {
      const embeddings = measured.embedding(
        {
          embed: async (_text, _type, _signal, observe) => {
            observe?.({ inputTokens: 9, outputTokens: 0, costUsd: 0 });
            return [1, 0];
          },
        },
        identity,
      );
      await withProviderReceipt("receipt-1", () =>
        embeddings.embed("PRIVATE_TEXT_SENTINEL", "document"),
      );
      assert.equal(records.at(-1)?.observedCostUsd, 0);
      assert.equal(records.at(-1)?.inputTokens, 9);
      assert.equal(records.at(-1)?.idempotencyKey, "receipt-1");
      const unpriced = measured.embedding(
        {
          embed: async (_text, _type, _signal, observe) => {
            observe?.({ inputTokens: 19, outputTokens: 0 });
            return [1, 0];
          },
        },
        identity,
      );
      await unpriced.embed("PRIVATE_TEXT_SENTINEL", "query");
      assert.equal(records.at(-1)?.source, "observed");
      assert.equal(records.at(-1)?.pricingKnown, false);
      assert.equal(records.at(-1)?.observedCostUsd, undefined);
      const invalid = measured.embedding(
        {
          embed: async (_text, _type, _signal, observe) => {
            observe?.({
              inputTokens: Infinity,
              outputTokens: -1,
              costUsd: NaN,
            });
            return [1, 0];
          },
        },
        identity,
      );
      await invalid.embed("bounded estimated content", "document");
      assert.equal(records.at(-1)?.source, "estimated");
      assert.ok(Number.isFinite(records.at(-1)?.inputTokens));
      await assert.rejects(
        measured
          .embedding({ embed: async () => [1, 0] }, identity, "workspace-b")
          .embed("private", "query"),
        /authorization_revoked/,
      );
      const failed = measured.judge(
        {
          model: "judge",
          assess: async (_input, _signal, observe) => {
            observe?.({ inputTokens: 40, outputTokens: 10, costUsd: 0.002 });
            throw new Error("PRIVATE_FAILURE_SENTINEL");
          },
        },
        { provider: "openrouter", model: "judge" },
        "evaluation_judging",
      );
      await assert.rejects(
        failed.assess(
          { answer: "private", passages: [] },
          new AbortController().signal,
        ),
      );
      assert.equal(records.at(-1)?.failed, true);
      assert.equal(records.at(-1)?.observedCostUsd, 0.002);
      const evaluation = measured.evaluationGenerator(
        {
          generate: async (_q, _c, _s, observe) => {
            observe?.({ inputTokens: 20, outputTokens: 5, costUsd: 0.001 });
            return "answer";
          },
        },
        { provider: "openrouter", model: "chat" },
      );
      const before = records.length;
      await evaluation.generate("question", "context");
      assert.equal(
        records.length,
        before,
        "normal answers retain the existing answer ledger",
      );
      await withProviderUsageScope(
        { tenantId: "workspace-a", actorKey: "user", purpose: "evaluation" },
        () => evaluation.generate("question", "context"),
      );
      assert.equal(records.at(-1)?.operation, "evaluation_generation");
    },
  );
  assert.doesNotMatch(
    JSON.stringify(records),
    /PRIVATE_|bounded estimated content/,
  );
});
