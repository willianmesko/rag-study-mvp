import { PgInvitationDeliveries } from "../../../workspaces/infrastructure/postgres/pg-invitation-deliveries.js";
import { InviteWorkspaceMember } from "../../../workspaces/application/integrations/workspace-invitations.js";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { WorkflowStateCodec } from "../../../../platform/workflows/workflow-state-codec.js";
import { rotateWorkflowKeys } from "../../../../platform/workflows/rotate-workflow-keys.js";
import { PgWorkflowRepository } from "../../../../platform/workflows/pg-workflow-repository.js";
import { PgIngestionJobRepository } from "../../../ingestion/infrastructure/postgres/pg-ingestion-job-repository.js";
import { PgUsageMetricsRepository } from "./pg-usage-metrics-repository.js";
import { QueueDocumentUploadUseCase } from "../../../ingestion/application/use-cases/queue-document-upload.js";
import {
  BudgetAlerts,
  DeliveryCommandError,
} from "../observability/budget-alerts.js";
import {
  withExecution,
  workflowEffect,
} from "../../../../platform/workflows/execution-context.js";
import { withCorrelation } from "../../../../platform/observability/observer.js";
import { ProviderMeasurements } from "../observability/measured-providers.js";
import { IntegrationFailure } from "../../../../platform/integrations/retry-policy.js";
import type { WorkflowLease } from "../../../../platform/workflows/types.js";

const url = process.env.MCP_TEST_DATABASE_URL;
const budget = {
  maxSteps: 40,
  maxCalls: 40,
  maxInputTokens: 100000,
  maxOutputTokens: 8000,
  maxCostMicros: 50000,
  timeoutMs: 60000,
};
test(
  "real PostgreSQL rotation, upload admission, effect journal and delivery recovery",
  { skip: !url, timeout: 40000 },
  async (t) => {
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url!).hostname),
      "Use a disposable local database.",
    );
    const schema = `resilience_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({
      connectionString: url,
      max: 6,
      options: `-c search_path=${schema},public`,
    });
    t.after(async () => {
      await pool.end();
      try {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        await admin.end();
      }
    });
    for (const name of [
      "tenants",
      "tenant_memberships",
      "tenant_daily_usage",
      "ingestion_jobs",
      "ingestion_job_events",
      "workflow_runs",
      "workflow_checkpoints",
      "workflow_writes",
      "workflow_effects",
      "workflow_events",
      "ai_usage_events",
      "budget_alert_outbox",
      "integration_delivery_events",
      "workspace_invitations",
      "workspace_invitation_requests",
      "audit_events",
    ]) {
      await admin.query(
        `CREATE TABLE ${schema}.${name} (LIKE public.${name} INCLUDING ALL)`,
      );
    }
    const workspace = async () => {
      const tenantId = randomUUID(),
        actorId = randomUUID();
      await pool.query(
        "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Fixture workspace')",
        [tenantId, `fixture-${tenantId}`],
      );
      await pool.query(
        "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
        [tenantId, actorId],
      );
      return { tenantId, actorId };
    };
    const key1 = randomBytes(32).toString("base64"),
      key2 = randomBytes(32).toString("base64");
    const legacy = new WorkflowStateCodec(key1),
      codec = new WorkflowStateCodec({
        activeKeyId: "k2",
        keys: { k2: key2 },
        legacyKey: key1,
      });

    await t.test(
      "staged key rotation verifies all four stores, resumes bounded batches and survives key retirement",
      async () => {
        const scope = { ...(await workspace()), runId: randomUUID() };
        const old = new PgWorkflowRepository(pool, legacy);
        await old.admit({
          ...scope,
          kind: "evaluation",
          version: "fixture-v1",
          budget,
          input: { secret: "PRIVATE_STATE_SENTINEL" },
        });
        const base = [scope.tenantId, scope.actorId, scope.runId];
        await pool.query(
          "INSERT INTO workflow_checkpoints(tenant_id,actor_id,run_id,graph_name,namespace,checkpoint_id,encoding,cipher) VALUES($1,$2,$3,'graph','ns','cp','json',$4)",
          [...base, legacy.json({ stage: 1 }, [...base, "graph", "ns", "cp"])],
        );
        await pool.query(
          "INSERT INTO workflow_writes(tenant_id,actor_id,run_id,graph_name,namespace,checkpoint_id,task_id,task_path,ordinal,encoding,cipher) VALUES($1,$2,$3,'graph','ns','cp','task','',0,'json',$4)",
          [
            ...base,
            legacy.json({ write: 2 }, [
              ...base,
              "graph",
              "ns",
              "cp",
              "task",
              "0",
            ]),
          ],
        );
        await pool.query(
          "INSERT INTO workflow_effects(tenant_id,actor_id,run_id,effect_key,cipher) VALUES($1,$2,$3,'effect',$4)",
          [...base, legacy.json({ result: 3 }, [...base, "effect", "effect"])],
        );
        const dry = await rotateWorkflowKeys(pool, codec, { apply: false });
        assert.equal(dry.remaining, 4);
        assert.equal(dry.changed, 0);
        const bounded = await rotateWorkflowKeys(pool, codec, {
          apply: true,
          batchSize: 1,
          maxBatches: 1,
        });
        assert.equal(bounded.complete, false);
        await rotateWorkflowKeys(pool, codec, { apply: true });
        const verified = await rotateWorkflowKeys(pool, codec, {
          apply: false,
        });
        assert.equal(verified.complete, true);
        assert.equal(verified.remaining, 0);
        await pool.query(
          "UPDATE workflow_runs SET status='completed' WHERE run_id=$1",
          [scope.runId],
        );
        // Repeated bounded commands must advance beyond the rows converted by a prior process.
        for (let i = 0; i < 5; i++) {
          const extra = { ...scope, runId: randomUUID() };
          await old.admit({
            ...extra,
            kind: "evaluation",
            version: "fixture-v1",
            budget,
            input: { i },
          });
          await pool.query(
            "UPDATE workflow_runs SET status='completed' WHERE run_id=$1",
            [extra.runId],
          );
        }
        for (let i = 0; i < 6; i++)
          await rotateWorkflowKeys(pool, codec, {
            apply: true,
            batchSize: 1,
            maxBatches: 1,
          });
        assert.equal(
          (await rotateWorkflowKeys(pool, codec, { apply: false })).remaining,
          0,
        );
        const retired = new WorkflowStateCodec({
          activeKeyId: "k2",
          keys: { k2: key2 },
        });
        const row = (
          await pool.query(
            "SELECT input_cipher FROM workflow_runs WHERE run_id=$1",
            [scope.runId],
          )
        ).rows[0];
        assert.deepEqual(retired.parse(row.input_cipher, [...base, "input"]), {
          secret: "PRIVATE_STATE_SENTINEL",
        });
        assert.throws(() =>
          legacy.decode(row.input_cipher, [...base, "input"]),
        );
        assert.throws(() =>
          retired.decode(row.input_cipher, [
            randomUUID(),
            ...base.slice(1),
            "input",
          ]),
        );
        const damaged = Buffer.from(row.input_cipher);
        damaged[damaged.length - 1] ^= 1;
        await pool.query(
          "UPDATE workflow_runs SET input_cipher=$2,status='completed' WHERE run_id=$1",
          [scope.runId, damaged],
        );
        await assert.rejects(
          rotateWorkflowKeys(
            pool,
            new WorkflowStateCodec({
              activeKeyId: "k3",
              keys: { k2: key2, k3: randomBytes(32).toString("base64") },
            }),
            { apply: true },
          ),
          /keep all previous keys/,
        );
        await pool.query("DELETE FROM workflow_runs WHERE run_id=$1", [
          scope.runId,
        ]);
        for (const table of [
          "workflow_checkpoints",
          "workflow_writes",
          "workflow_effects",
        ])
          await pool.query(`DELETE FROM ${table} WHERE run_id=$1`, [
            scope.runId,
          ]);
      },
    );

    await t.test(
      "duplicate concurrent uploads commit one quota and original; conflicts and foreign workspaces stay separate",
      async () => {
        const scope = await workspace(),
          other = await workspace(),
          jobs = new PgIngestionJobRepository(pool);
        const objects = new Map<string, Buffer>();
        const upload = new QueueDocumentUploadUseCase(
          jobs,
          {
            isEnabled: () => true,
            put: async (input) => {
              objects.set(input.path, input.payload);
            },
            get: async (path) => objects.get(path)!,
            remove: async (path) => {
              objects.delete(path);
            },
          },
          100,
        );
        const input = {
          ...scope,
          tenantId: scope.tenantId,
          actorId: scope.actorId,
          idempotencyKey: "same-upload-request-key",
          source: "handbook",
          filename: "handbook.txt",
          mimeType: "text/plain",
          payload: Buffer.from("Private internal guide."),
        };
        const pair = await Promise.all([
          upload.execute(input),
          upload.execute(input),
        ]);
        assert.equal(pair[0].id, pair[1].id);
        assert.equal(objects.size, 1);
        const usage = (
          await pool.query(
            "SELECT uploaded_bytes FROM tenant_daily_usage WHERE tenant_id=$1 AND actor_key=$2",
            [scope.tenantId, scope.actorId],
          )
        ).rows[0];
        assert.equal(Number(usage.uploaded_bytes), input.payload.length);
        assert.equal(
          (await jobs.listEvents(pair[0].id, scope.tenantId, 50)).length,
          1,
        );
        await assert.rejects(
          upload.execute({
            ...input,
            payload: Buffer.from("Different content."),
          }),
          /different document/,
        );
        await assert.rejects(
          upload.execute({
            ...input,
            idempotencyKey: "too-large-upload-request",
            payload: Buffer.alloc(101),
          }),
          /quota/,
        );
        assert.equal(objects.size, 1);
        const second = await upload.execute({ ...input, ...other });
        assert.notEqual(second.id, pair[0].id);
        assert.equal(objects.size, 2);
        const lease = await jobs.claimNext();
        assert.ok(lease);
        const workflows = new PgWorkflowRepository(pool, codec);
        await workflows.admit({
          tenantId: lease.tenantId,
          actorId: "ingestion",
          runId: lease.id,
          kind: "ingestion",
          version: "fixture-v1",
          budget,
          input: { jobId: lease.id },
        });
        await pool.query(
          "UPDATE ingestion_jobs SET updated_at=NOW()-interval '20 minutes' WHERE id=$1",
          [lease.id],
        );
        const next = await jobs.claimNext();
        assert.ok(next);
        assert.notEqual(
          next.id,
          lease.id,
          "a live workflow is not admitted a second time",
        );
        assert.equal(await jobs.claimNext(), null);
        await pool.query(
          "UPDATE ingestion_jobs SET status='completed' WHERE id=ANY($1::uuid[])",
          [[lease.id, next.id]],
        );
        await pool.query(
          "UPDATE workflow_runs SET status='completed' WHERE run_id=$1",
          [lease.id],
        );
      },
    );

    await t.test(
      "provider effects deduplicate results and ledger receipts; uncertain delivery blocks automatic retry",
      async () => {
        const scope = { ...(await workspace()), runId: randomUUID() },
          repo = new PgWorkflowRepository(pool, codec);
        await withCorrelation("correlation-fixture", () =>
          repo.admit({
            ...scope,
            kind: "evaluation",
            version: "fixture-v1",
            input: {},
            budget,
          }),
        );
        const lease = (await repo.claim(["evaluation"]))!;
        assert.equal(lease.runId, scope.runId);
        assert.equal(lease.correlationId, "correlation-fixture");
        const ledger = new PgUsageMetricsRepository(pool),
          measurements = new ProviderMeasurements(ledger);
        let calls = 0;
        const embed = measurements.embedding(
          {
            embed: async (_text, _kind, _signal, observe) => {
              calls++;
              observe?.({ inputTokens: 5, outputTokens: 0, costUsd: 0.0001 });
              return [1, 0];
            },
          },
          { provider: "openrouter", model: "embedding", dimensions: 2 },
          scope.tenantId,
        );
        const run = <T>(work: () => Promise<T>) =>
          withExecution(
            {
              lease,
              repository: repo,
              signal: new AbortController().signal,
              authorize: async () => true,
              node: "embedding",
              effects: new Map(),
              publications: { next: 0 },
            },
            work,
          );
        for (let i = 0; i < 17; i++)
          await run(() =>
            workflowEffect(
              "embedding:fixture",
              { text: `chunk-${i}` },
              { calls: 1 },
              () => embed.embed(`chunk-${i}`, "document"),
            ),
          );
        await run(() =>
          workflowEffect(
            "embedding:fixture",
            { text: "chunk-0" },
            { calls: 1 },
            () => embed.embed("chunk-0", "document"),
          ),
        );
        assert.equal(calls, 17);
        const summary = await ledger.summarize({
          tenantId: scope.tenantId,
          days: 30,
        });
        assert.equal(summary.requests, 17);
        assert.equal(summary.inputTokens, 85);
        assert.ok(summary.extendedSince);
        assert.ok(Math.abs(summary.observedCostUsd! - 0.0017) < 1e-9);
        let knownRetry = 0;
        await assert.rejects(
          repo.effect(lease, "known-rejection", { calls: 1 }, async () => {
            knownRetry++;
            throw new IntegrationFailure("rate_limited", 429);
          }),
        );
        assert.equal(
          await repo.effect(
            lease,
            "known-rejection",
            { calls: 1 },
            async () => {
              knownRetry++;
              return "done";
            },
          ),
          "done",
        );
        assert.equal(knownRetry, 2);
        let uncertain = 0;
        await assert.rejects(
          repo.effect(lease, "uncertain-paid-call", { calls: 1 }, async () => {
            uncertain++;
            throw new IntegrationFailure("transport_unknown");
          }),
        );
        await assert.rejects(
          repo.effect(lease, "uncertain-paid-call", { calls: 1 }, async () => {
            uncertain++;
            return "wrong";
          }),
          /effect_outcome_unknown/,
        );
        assert.equal(uncertain, 1);
        await repo.finish(lease, "completed");
        // Untouched historical rows retain their earlier coverage marker and estimates.
        await pool.query(
          "INSERT INTO ai_usage_events(tenant_id,actor_key,operation,provider,model,latency_ms,estimated_cost_usd,measurement_version) VALUES($1,'old','question_answering','old','legacy',10,0.01,1)",
          [scope.tenantId],
        );
        const unpriced = measurements.embedding(
          {
            embed: async (_t, _k, _s, observe) => {
              observe?.({ inputTokens: 12, outputTokens: 0 });
              return [1, 0];
            },
          },
          { provider: "openrouter", model: "fixture", dimensions: 2 },
          scope.tenantId,
        );
        await unpriced.embed("private", "query");
        const mixed = await ledger.summarize({
          tenantId: scope.tenantId,
          days: 30,
        });
        assert.equal(mixed.unpricedRequests, 1);
        assert.equal(
          (
            await pool.query(
              "SELECT measurement_version,pricing_known,observed_cost_usd FROM ai_usage_events WHERE tenant_id=$1 AND model='legacy'",
              [scope.tenantId],
            )
          ).rows[0].measurement_version,
          1,
        );
      },
    );

    await t.test(
      "signed notifications retry with one ID; permanent failures, stale state and owner replay are audited",
      async () => {
        const scope = await workspace(),
          foreign = await workspace();
        const ledger = new PgUsageMetricsRepository(pool);
        await ledger.record({
          tenantId: scope.tenantId,
          actorKey: "private",
          operation: "embedding_document",
          provider: "fixture",
          model: "fixture",
          cacheHit: false,
          inputTokens: 10,
          outputTokens: 0,
          latencyMs: 2,
          estimatedCostUsd: 2,
          pricingKnown: true,
          failed: false,
        });
        const seen: Array<{ body: string; headers: Headers }> = [],
          secret = "test-signing-secret-32-characters-long";
        let status = 429;
        const options = {
          url: "https://hooks.example.com/budget",
          secret,
          thresholdUsd: 1,
          fetch: (async (_url, init) => {
            seen.push({
              body: String(init?.body),
              headers: new Headers(init?.headers),
            });
            return new Response("private upstream response", {
              status,
              headers: { "retry-after": "10" },
            });
          }) as typeof fetch,
        };
        const alerts = new BudgetAlerts(pool, options);
        await Promise.all([
          alerts.enqueue(scope.tenantId),
          alerts.enqueue(scope.tenantId),
        ]);
        const initial = await alerts.status(scope.tenantId);
        assert.equal(initial.recent.length, 1);
        await Promise.all([
          alerts.work(),
          new BudgetAlerts(pool, options).work(),
        ]);
        assert.equal(
          seen.length,
          1,
          "concurrent replicas claim a single delivery",
        );
        const first = (await alerts.status(scope.tenantId)).recent[0];
        assert.equal(first.status, "queued");
        assert.equal(first.attempts, 1);
        assert.equal(seen[0].headers.get("idempotency-key"), first.id);
        const timestamp = seen[0].headers.get("x-lumora-timestamp");
        assert.equal(
          seen[0].headers.get("x-lumora-signature"),
          "sha256=" +
            createHmac("sha256", secret)
              .update(timestamp + "." + seen[0].body)
              .digest("hex"),
        );
        status = 204;
        // A 204 cannot carry a response body; use a separate success transport.
        const success = new BudgetAlerts(pool, {
          ...options,
          fetch: (async (_url, init) => {
            seen.push({
              body: String(init?.body),
              headers: new Headers(init?.headers),
            });
            return new Response(null, { status: 204 });
          }) as typeof fetch,
        });
        await pool.query(
          "UPDATE budget_alert_outbox SET available_at=NOW()-interval '1 second' WHERE id=$1",
          [first.id],
        );
        await success.work();
        assert.equal(
          (await alerts.status(scope.tenantId)).recent[0].status,
          "delivered",
        );
        assert.equal(seen[0].body, seen[1].body);
        assert.equal(
          seen[0].headers.get("idempotency-key"),
          seen[1].headers.get("idempotency-key"),
        );
        await pool.query(
          "UPDATE budget_alert_outbox SET status='sending',attempts=1,lease_token=gen_random_uuid(),lease_until=NOW()-interval '1 second' WHERE id=$1",
          [first.id],
        );
        status = 403;
        await alerts.work();
        assert.equal(
          (await alerts.status(scope.tenantId)).recent[0].status,
          "dead_letter",
        );
        const command = {
          ...scope,
          id: first.id as string,
          expectedAttempts: 2,
          idempotencyKey: "same-owner-replay-key",
        };
        await assert.rejects(
          alerts.replay({ ...command, actorId: foreign.actorId }),
          (error) =>
            error instanceof DeliveryCommandError && error.code === "forbidden",
        );
        await assert.rejects(
          alerts.replay({ ...command, expectedAttempts: 1 }),
          /stale_state/,
        );
        assert.equal((await alerts.replay(command)).replayed, true);
        assert.equal((await alerts.replay(command)).replayed, false);
        const events = (
          await pool.query(
            "SELECT outcome,reason,actor_user_id FROM integration_delivery_events WHERE delivery_id=$1 ORDER BY id",
            [first.id],
          )
        ).rows;
        assert.ok(events.some((e) => e.outcome === "retry"));
        assert.ok(
          events.some(
            (e) =>
              e.outcome === "replayed" && e.actor_user_id === scope.actorId,
          ),
        );
        assert.doesNotMatch(
          JSON.stringify(events),
          /private upstream response|test-signing|hooks.example/,
        );
        await pool.query(
          "UPDATE budget_alert_outbox SET status='sending',attempts=8,lease_until=NOW()-interval '1 second' WHERE id=$1",
          [first.id],
        );
        const count = seen.length;
        await alerts.work();
        assert.equal(seen.length, count);
        assert.equal(
          (await alerts.status(scope.tenantId)).recent[0].reason,
          "attempts_exhausted",
        );
      },
    );
    await t.test(
      "invitation retries converge on one email and atomic membership; uncertain delivery and revocation stop replay",
      async () => {
        const scope = { ...(await workspace()), requestId: randomUUID() },
          repo = new PgInvitationDeliveries(pool);
        let calls = 0,
          release!: () => void;
        const recipient = randomUUID(),
          gate = new Promise<void>((resolve) => {
            release = resolve;
          });
        const invites = new InviteWorkspaceMember(repo, {
          send: async () => {
            calls++;
            await gate;
            return recipient;
          },
        });
        const input = {
          ...scope,
          email: "recipient@example.com",
          role: "viewer" as const,
          idempotencyKey: "one-invitation-command",
        };
        const first = invites.execute(input);
        while (!calls) await new Promise((resolve) => setTimeout(resolve, 5));
        await assert.rejects(invites.execute(input), /already being delivered/);
        release();
        const receipt = await first;
        assert.equal((await invites.execute(input)).userId, receipt.userId);
        assert.equal(calls, 1);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
              [scope.tenantId, recipient],
            )
          ).rows[0].n,
          1,
        );
        await assert.rejects(
          invites.execute({ ...input, role: "editor" }),
          /different request/,
        );
        const failed = new InviteWorkspaceMember(repo, {
          send: async () => {
            calls++;
            throw new IntegrationFailure("transport_unknown");
          },
        });
        const unknown = {
          ...scope,
          email: "unconfirmed@example.com",
          role: "viewer" as const,
          idempotencyKey: "unknown-invitation-key",
        };
        await assert.rejects(failed.execute(unknown), /unconfirmed/);
        const count = calls;
        await assert.rejects(failed.execute(unknown), /unconfirmed/);
        assert.equal(calls, count);
        const pending = {
          ...scope,
          email: "expired@example.com",
          role: "viewer" as const,
          idempotencyKey: "expired-invitation-key",
        };
        let admitRelease!: () => void;
        const stop = new Promise<void>((resolve) => {
          admitRelease = resolve;
        });
        const stale = new InviteWorkspaceMember(repo, {
          send: async () => {
            await stop;
            return randomUUID();
          },
        });
        const inFlight = stale.execute(pending);
        let rows: unknown[] = [];
        for (let i = 0; i < 100 && !rows.length; i++) {
          rows = (
            await pool.query(
              "SELECT id FROM workspace_invitation_requests WHERE tenant_id=$1 AND email=$2 AND state='sending'",
              [scope.tenantId, pending.email],
            )
          ).rows;
          if (!rows.length)
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        assert.equal(rows.length, 1);
        await pool.query(
          "UPDATE workspace_invitation_requests SET lease_until=NOW()-interval '1 second' WHERE tenant_id=$1 AND email=$2",
          [scope.tenantId, pending.email],
        );
        await assert.rejects(stale.execute(pending), /unconfirmed/);
        admitRelease();
        await assert.rejects(inFlight, /unconfirmed/);
        const audit = (
          await pool.query(
            "SELECT metadata FROM audit_events WHERE tenant_id=$1",
            [scope.tenantId],
          )
        ).rows;
        assert.doesNotMatch(
          JSON.stringify(audit),
          /recipient@|unconfirmed@|expired@/,
        );
        await pool.query(
          "UPDATE tenant_memberships SET role='viewer' WHERE tenant_id=$1 AND user_id=$2",
          [scope.tenantId, scope.actorId],
        );
        await assert.rejects(invites.execute(input), /owner access/);
      },
    );
  },
);
