import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import type { Pool } from "pg";
import {
  classifyStatus,
  retryAfterMs,
  retryDelayMs,
} from "../../application/integrations/retry-policy.js";
import { recordOperationalEvent } from "../../application/observability.js";
import { postPublicWebhook } from "../http/public-webhook-client.js";
import { parseTarget } from "../ingestion/public-html-fetcher.js";
export const deliveryDisposition = classifyStatus;
export class DeliveryCommandError extends Error {
  constructor(readonly code: "forbidden" | "not_found" | "stale_state") {
    super(`Delivery command stopped: ${code}.`);
    this.name = "DeliveryCommandError";
  }
}
export class BudgetAlerts {
  private cursor: string | null = null;
  constructor(
    private readonly pool: Pool,
    private readonly options: {
      url?: string;
      secret?: string;
      thresholdUsd: number;
      fetch?: typeof fetch;
      log?: (record: Record<string, unknown>) => void;
    },
  ) {
    if (options.url) {
      parseTarget(options.url);
      if (
        new URL(options.url).hash ||
        !options.secret ||
        options.secret.length < 32
      )
        throw new Error(
          "Budget webhooks require a public HTTPS URL and a signing secret.",
        );
    }
  }
  get configured() {
    return Boolean(
      this.options.url && this.options.secret && this.options.thresholdUsd > 0,
    );
  }
  async enqueue(tenantId: string) {
    if (!this.configured) return;
    await this.pool.query(
      `WITH inserted AS(INSERT INTO budget_alert_outbox(tenant_id,window_date,threshold_micros,cost_usd,unpriced_requests)
      SELECT $1,(clock_timestamp() AT TIME ZONE 'UTC')::date,$2,sum(coalesce(observed_cost_usd,estimated_cost_usd)),count(*) FILTER(WHERE pricing_known=false AND observed_cost_usd IS NULL)
      FROM ai_usage_events WHERE tenant_id=$1 AND created_at>=clock_timestamp()-interval '30 days' AND created_at<=clock_timestamp()
      HAVING sum(coalesce(observed_cost_usd,estimated_cost_usd))>=$3
      ON CONFLICT(tenant_id,window_date,threshold_micros) DO NOTHING RETURNING id,tenant_id)
      INSERT INTO integration_delivery_events(tenant_id,delivery_id,outcome,reason,attempt) SELECT tenant_id,id,'queued','threshold_exceeded',0 FROM inserted`,
      [
        tenantId,
        Math.ceil(this.options.thresholdUsd * 1e6),
        this.options.thresholdUsd,
      ],
    );
  }
  async status(tenantId: string) {
    const { rows } = await this.pool.query(
      "SELECT status,count(*)::int AS count FROM budget_alert_outbox WHERE tenant_id=$1 AND created_at>=clock_timestamp()-interval '30 days' GROUP BY status",
      [tenantId],
    );
    const { rows: recent } = await this.pool.query(
      "SELECT id,status,attempts,last_code AS reason,available_at,created_at,delivered_at FROM budget_alert_outbox WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50",
      [tenantId],
    );
    return {
      configured: this.configured,
      channel: "webhook",
      windowDays: 30,
      deduplication: "daily",
      deliveries: rows,
      recent,
    };
  }
  async replay(input: {
    tenantId: string;
    actorId: string;
    id: string;
    expectedAttempts: number;
    idempotencyKey: string;
  }) {
    z.uuid().parse(input.tenantId);
    z.uuid().parse(input.actorId);
    z.uuid().parse(input.id);
    z.number().int().min(1).max(8).parse(input.expectedAttempts);
    const key = z
      .string()
      .min(16)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/)
      .parse(input.idempotencyKey);
    const commandKey = createHash("sha256")
      .update(JSON.stringify([input.actorId, key, input.expectedAttempts]))
      .digest("hex");
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const member = await db.query(
        "SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 AND role='owner' FOR SHARE",
        [input.tenantId, input.actorId],
      );
      if (!member.rowCount) throw new DeliveryCommandError("forbidden");
      const {
        rows: [alert],
      } = await db.query(
        "SELECT status,attempts FROM budget_alert_outbox WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [input.tenantId, input.id],
      );
      if (!alert) throw new DeliveryCommandError("not_found");
      const prior = await db.query(
        "SELECT 1 FROM integration_delivery_events WHERE tenant_id=$1 AND delivery_id=$2 AND command_key=$3",
        [input.tenantId, input.id, commandKey],
      );
      if (prior.rowCount) {
        await db.query("COMMIT");
        return { replayed: false, id: input.id };
      }
      if (
        alert.status !== "dead_letter" ||
        alert.attempts !== input.expectedAttempts
      )
        throw new DeliveryCommandError("stale_state");
      await db.query(
        "UPDATE budget_alert_outbox SET status='queued',attempts=0,last_code='owner_replayed',available_at=clock_timestamp(),lease_token=NULL,lease_until=NULL WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.id],
      );
      await db.query(
        "INSERT INTO integration_delivery_events(tenant_id,delivery_id,outcome,reason,attempt,actor_user_id,command_key) VALUES($1,$2,'replayed','owner_replayed',$3,$4,$5)",
        [
          input.tenantId,
          input.id,
          input.expectedAttempts,
          input.actorId,
          commandKey,
        ],
      );
      await db.query("COMMIT");
      recordOperationalEvent({
        operation: "budget_webhook",
        outcome: "replayed",
        reason: "owner_replayed",
      });
      return { replayed: true, id: input.id };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async work() {
    if (!this.configured) return;
    const { rows: tenants } = await this.pool.query(
      // A committed ledger row may have outlived a failed enqueue or a stopped
      // worker. Repair the same window that enqueue uses, even with no new calls.
      "SELECT tenant_id FROM ai_usage_events WHERE created_at>=clock_timestamp()-interval '30 days' AND created_at<=clock_timestamp() AND ($1::uuid IS NULL OR tenant_id>$1) GROUP BY tenant_id ORDER BY tenant_id LIMIT 100",
      [this.cursor],
    );
    this.cursor = tenants.length === 100 ? tenants.at(-1)!.tenant_id : null;
    for (const { tenant_id } of tenants) await this.enqueue(tenant_id);
    // Recover a worker that disappeared on its last permitted attempt, without starving newer alerts.
    await this.pool
      .query(`WITH expired AS(UPDATE budget_alert_outbox SET status='dead_letter',last_code='attempts_exhausted',lease_token=NULL,lease_until=NULL WHERE status='sending' AND attempts>=8 AND lease_until<=clock_timestamp() RETURNING id,tenant_id,attempts)
      INSERT INTO integration_delivery_events(tenant_id,delivery_id,outcome,reason,attempt) SELECT tenant_id,id,'dead_letter','attempts_exhausted',attempts FROM expired`);
    for (let i = 0; i < 10; i++) {
      const {
        rows: [alert],
      } = await this.pool
        .query(`WITH picked AS(SELECT id FROM budget_alert_outbox WHERE attempts<8 AND ((status='queued' AND available_at<=clock_timestamp()) OR (status='sending' AND lease_until<=clock_timestamp())) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED),
        claimed AS(UPDATE budget_alert_outbox a SET status='sending',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '30 seconds' FROM picked WHERE a.id=picked.id RETURNING a.*),
        logged AS(INSERT INTO integration_delivery_events(tenant_id,delivery_id,outcome,reason,attempt) SELECT tenant_id,id,'sending','attempt_started',attempts FROM claimed)
        SELECT claimed.*,window_date::text AS window_date_iso FROM claimed`);
      if (!alert) break;
      let outcome: ReturnType<typeof classifyStatus> = "retry",
        code = "delivery_network_failure",
        retryAfter: number | undefined;
      const timestamp = String(Math.floor(Date.now() / 1000));
      const payload = JSON.stringify({
        id: alert.id,
        type: "budget.threshold_exceeded",
        workspaceId: alert.tenant_id,
        windowDays: 30,
        thresholdUsd: Number(alert.threshold_micros) / 1e6,
        recordedCostUsd: Number(alert.cost_usd),
        unpricedRequests: alert.unpriced_requests,
        measurement: "reported_cost_and_configured_estimates",
        date:alert.window_date_iso,
      });
      try {
        const signature = createHmac("sha256", this.options.secret!)
          .update(timestamp + "." + payload)
          .digest("hex");
        const response = await (this.options.fetch ?? postPublicWebhook)(
          this.options.url!,
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(3000),
            headers: {
              "content-type": "application/json",
              "idempotency-key": alert.id,
              "x-lumora-timestamp": timestamp,
              "x-lumora-signature": "sha256=" + signature,
            },
            body: payload,
          },
        );
        outcome = classifyStatus(response.status);
        code =
          outcome === "delivered" ? "delivered" : `http_${response.status}`;
        retryAfter = retryAfterMs(response.headers.get("retry-after"));
        await response.body?.cancel();
      } catch {
        /* Never store destination URLs, upstream text or response bodies. */
      }
      const status =
        outcome === "retry"
          ? alert.attempts >= 8
            ? "dead_letter"
            : "queued"
          : outcome;
      const delay = Math.ceil(
        retryDelayMs(alert.attempts, {
          baseMs: 10_000,
          capMs: 3_600_000,
          retryAfterMs: retryAfter,
        }) / 1000,
      );
      const { rowCount } = await this.pool.query(
        `WITH finished AS(UPDATE budget_alert_outbox SET status=$3,last_code=$4,lease_token=NULL,lease_until=NULL,available_at=clock_timestamp()+$5::int*interval '1 second',delivered_at=CASE WHEN $3='delivered' THEN clock_timestamp() ELSE NULL END WHERE id=$1 AND lease_token=$2 RETURNING id,tenant_id,attempts)
        INSERT INTO integration_delivery_events(tenant_id,delivery_id,outcome,reason,attempt) SELECT tenant_id,id,$6,$4,attempts FROM finished`,
        [
          alert.id,
          alert.lease_token,
          status,
          code,
          delay,
          status === "queued" ? "retry" : status,
        ],
      );
      if (rowCount) {
        recordOperationalEvent({
          operation: "budget_webhook",
          outcome: status === "queued" ? "retry" : status,
          reason: code,
        });
        this.options.log?.({
          event: "budget_alert_delivery",
          reason: code,
          outcome: status,
          alertId: alert.id,
          attempt: alert.attempts,
        });
      }
    }
    await this.pool.query(
      "DELETE FROM budget_alert_outbox WHERE created_at<clock_timestamp()-interval '90 days'",
    );
  }
}
