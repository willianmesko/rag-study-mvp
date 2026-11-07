import { withProviderReceipt } from "../../application/provider-usage-context.js";
import { IntegrationFailure } from "../../application/integrations/retry-policy.js";
import { currentCorrelationId } from "../../application/observability.js";
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  workflowBudgetSchema,
  WorkflowGuardError,
  type Reservation,
  type WorkflowAdmission,
  type WorkflowKind,
  type WorkflowLease,
  type WorkflowRepository,
  type WorkflowScope,
  type WorkflowSnapshot,
} from "../../application/workflows/types.js";
import { WorkflowStateCodec } from "../security/workflow-state-codec.js";

type Row = {
  conversation_id?: string | null;
  correlation_id?: string | null;
  tenant_id: string;
  actor_id: string;
  run_id: string;
  kind: WorkflowKind;
  version: string;
  status: WorkflowSnapshot["status"];
  stage: string | null;
  steps: number;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
  budget: unknown;
  attempts: number;
  error_code: string | null;
  result_id: string | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  deadline_at: Date;
  approved_by: string | null;
  lease_token: string;
  input_cipher: Buffer;
  input_hash: string;
};
export const workflowParams = (scope: WorkflowScope) => [
  scope.tenantId,
  scope.actorId,
  scope.runId,
];
const map = (r: Row): WorkflowSnapshot => ({
  correlationId: r.correlation_id ?? r.run_id,
  ...(r.conversation_id ? { conversationId: r.conversation_id } : {}),
  tenantId: r.tenant_id,
  actorId: r.actor_id,
  runId: r.run_id,
  kind: r.kind,
  version: r.version,
  status: r.status,
  stage: r.stage,
  steps: r.steps,
  calls: r.calls,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  costMicros: r.cost_micros,
  budget: workflowBudgetSchema.parse(r.budget),
  attempts: r.attempts,
  errorCode: r.error_code,
  resultId: r.result_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  expiresAt: r.expires_at,
  deadlineAt: r.deadline_at,
  approvedBy: r.approved_by,
});

export class PgWorkflowRepository implements WorkflowRepository {
  constructor(
    readonly pool: Pool,
    readonly codec: WorkflowStateCodec,
  ) {}

  async admit(input: WorkflowAdmission) {
    const budget = workflowBudgetSchema.parse(input.budget);
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          input.kind,
          input.version,
          input.input,
          budget,
          ...(input.conversationId ? [input.conversationId] : []),
        ]),
      )
      .digest("hex");
    const cipher = this.codec.json(input.input, [
      ...workflowParams(input),
      "input",
    ]);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT id FROM tenants WHERE id=$1 FOR NO KEY UPDATE",
        [input.tenantId],
      );
      const previous = (
        await client.query<Row>(
          "SELECT * FROM workflow_runs WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3",
          workflowParams(input),
        )
      ).rows[0];
      if (input.kind === "ingestion") {
        const job = await client.query(
          "SELECT 1 FROM ingestion_jobs WHERE tenant_id=$1 AND id=$2 AND status IN ('processing','completed') FOR SHARE",
          [input.tenantId, input.runId],
        );
        if (!job.rowCount) throw new WorkflowGuardError("cancelled");
      }
      if (!previous) {
        const {
          rows: [count],
        } = await client.query<{ active: number }>(
          "SELECT count(*)::int AS active FROM workflow_runs WHERE tenant_id=$1 AND kind=$2 AND status IN ('queued','running','waiting_approval') AND expires_at>clock_timestamp()",
          [input.tenantId, input.kind],
        );
        if (
          (count?.active ?? 0) >=
          (input.kind === "evaluation" ? 1 : input.kind === "chat" ? 5 : 20)
        )
          throw new WorkflowGuardError("queue_full");
      }
      const inserted = await client.query<Row>(
        `INSERT INTO workflow_runs(tenant_id,actor_id,run_id,kind,version,input_hash,input_cipher,budget,deadline_at,conversation_id,correlation_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+$9*interval '1 millisecond',$10,$11)
        ON CONFLICT(tenant_id,actor_id,run_id) DO NOTHING RETURNING *`,
        [
          ...workflowParams(input),
          input.kind,
          input.version,
          hash,
          cipher,
          JSON.stringify(budget),
          budget.timeoutMs,
          input.conversationId ?? null,
          input.correlationId ?? currentCorrelationId() ?? input.runId,
        ],
      );
      const row =
        inserted.rows[0] ??
        (
          await client.query<Row>(
            "SELECT * FROM workflow_runs WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 FOR UPDATE",
            workflowParams(input),
          )
        ).rows[0]!;
      if (row.input_hash !== hash)
        throw new WorkflowGuardError("definition_changed");
      if (
        previous &&
        input.kind === "ingestion" &&
        ["failed", "cancelled"].includes(row.status)
      ) {
        const ready = await client.query(
          "SELECT 1 FROM ingestion_jobs WHERE tenant_id=$1 AND id=$2 AND status='processing'",
          [input.tenantId, input.runId],
        );
        if (ready.rowCount) {
          await client.query(
            "UPDATE workflow_runs SET status='queued',error_code=NULL,deadline_at=clock_timestamp()+$4*interval '1 millisecond',updated_at=clock_timestamp() WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3",
            [...workflowParams(input), budget.timeoutMs],
          );
          row.status = "queued";
          row.error_code = null;
          row.deadline_at = new Date(Date.now() + budget.timeoutMs);
        }
      }
      if (inserted.rowCount && input.kind === "chat") {
        const chat = await client.query(
          `INSERT INTO chat_runs(tenant_id,actor_id,run_id,deadline_at,conversation_id)
          VALUES($1,$2,$3,$4::timestamptz+interval '5 seconds',$5) ON CONFLICT DO NOTHING RETURNING run_id`,
          [
            ...workflowParams(input),
            row.deadline_at,
            input.conversationId ?? null,
          ],
        );
        if (chat.rowCount !== 1)
          throw new WorkflowGuardError("definition_changed");
        await client.query(
          'INSERT INTO chat_run_events(tenant_id,actor_id,run_id,event_id,event) VALUES($1,$2,$3,1,\'{"type":"accepted"}\')',
          workflowParams(input),
        );
      }
      await client.query("COMMIT");
      return map(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claim(kinds: readonly WorkflowKind[]): Promise<WorkflowLease | null> {
    const result = await this.pool.query<Row>(
      `WITH candidate AS (
      SELECT tenant_id,actor_id,run_id FROM workflow_runs WHERE kind=ANY($1::text[]) AND expires_at>clock_timestamp() AND available_at<=clock_timestamp()
      AND (status='queued' OR (status='running' AND lease_until<clock_timestamp()))
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE workflow_runs r SET status='running',lease_token=$2,lease_until=clock_timestamp()+interval '10 seconds',
        attempts=attempts+1,updated_at=clock_timestamp() FROM candidate c
      WHERE r.tenant_id=c.tenant_id AND r.actor_id=c.actor_id AND r.run_id=c.run_id RETURNING r.*`,
      [kinds, randomUUID()],
    );
    const row = result.rows[0];
    if (!row) return null;
    const lease = {
      ...map(row),
      leaseToken: row.lease_token,
      input: undefined as unknown,
    };
    try {
      lease.input = this.codec.parse(row.input_cipher, [
        ...workflowParams(lease),
        "input",
      ]);
    } catch {
      await this.finish(lease, "failed", undefined, "state_unreadable");
      return null;
    }
    return lease;
  }

  async heartbeat(lease: WorkflowLease) {
    const r = await this.pool.query(
      `UPDATE workflow_runs SET lease_until=clock_timestamp()+interval '10 seconds'
      WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND lease_token=$4 AND status='running'
      AND lease_until>clock_timestamp() AND deadline_at>clock_timestamp() AND expires_at>clock_timestamp()`,
      [...workflowParams(lease), lease.leaseToken],
    );
    return r.rowCount === 1;
  }
  async release(
    lease: WorkflowLease,
    retry?: { reason: string; delayMs: number },
  ) {
    await this.pool.query(
      `UPDATE workflow_runs SET status='queued',lease_token=NULL,lease_until=NULL,error_code=$5,available_at=clock_timestamp()+$6*interval '1 millisecond',updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND lease_token=$4 AND status='running'`,
      [
        ...workflowParams(lease),
        lease.leaseToken,
        retry?.reason ?? null,
        retry?.delayMs ?? 0,
      ],
    );
  }

  async fenced<T>(
    lease: WorkflowLease,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout='3s'");
      const r = await client.query(
        `SELECT 1 FROM workflow_runs WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3
        AND lease_token=$4 AND status='running' AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() FOR UPDATE`,
        [...workflowParams(lease), lease.leaseToken],
      );
      if (!r.rowCount) throw new WorkflowGuardError("lease_lost");
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async reserve(lease: WorkflowLease, amount: Reservation, stage?: string) {
    const units = [
      amount.steps ?? 0,
      amount.calls ?? 0,
      amount.inputTokens ?? 0,
      amount.outputTokens ?? 0,
      amount.costMicros ?? 0,
    ];
    if (units.some((n) => !Number.isSafeInteger(n) || n < 0))
      throw new WorkflowGuardError("budget_exceeded");
    const r = await this.pool.query(
      `UPDATE workflow_runs SET steps=steps+$5,calls=calls+$6,input_tokens=input_tokens+$7,
      output_tokens=output_tokens+$8,cost_micros=cost_micros+$9,stage=COALESCE($10,stage),updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND lease_token=$4 AND status='running'
      AND lease_until>clock_timestamp() AND deadline_at>clock_timestamp() AND expires_at>clock_timestamp()
      AND steps+$5<=(budget->>'maxSteps')::int AND calls+$6<=(budget->>'maxCalls')::int
      AND input_tokens+$7<=(budget->>'maxInputTokens')::int AND output_tokens+$8<=(budget->>'maxOutputTokens')::int
      AND cost_micros+$9<=(budget->>'maxCostMicros')::int`,
      [...workflowParams(lease), lease.leaseToken, ...units, stage ?? null],
    );
    if (!r.rowCount) {
      const owner = await this.pool.query<{ lease_token: string | null }>(
        "SELECT lease_token FROM workflow_runs WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3",
        workflowParams(lease),
      );
      if (owner.rows[0]?.lease_token !== lease.leaseToken)
        throw new WorkflowGuardError("lease_lost");
      const current = await this.get(lease);
      throw new WorkflowGuardError(
        current?.status === "cancelled"
          ? "cancelled"
          : current?.deadlineAt.getTime()! <= Date.now()
            ? "deadline_exceeded"
            : current?.status === "running"
              ? "budget_exceeded"
              : "lease_lost",
      );
    }
  }

  async event(
    lease: WorkflowLease,
    stage: string,
    outcome: string,
    durationMs?: number,
  ) {
    await this.fenced(lease, async (client) => {
      await client.query(
        "INSERT INTO workflow_events(tenant_id,actor_id,run_id,stage,outcome,duration_ms) VALUES($1,$2,$3,$4,$5,$6)",
        [...workflowParams(lease), stage, outcome, durationMs ?? null],
      );
    });
  }

  async effect<T>(
    lease: WorkflowLease,
    key: string,
    amount: Reservation,
    operation: () => Promise<T>,
  ): Promise<T> {
    const admission = await this.fenced(lease, async (client) => {
      const {
        rows: [existing],
      } = await client.query<{
        cipher: Buffer | null;
        attempts: number;
        state: string | null;
        last_code: string | null;
      }>(
        "SELECT cipher,attempts,state,last_code FROM workflow_effects WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND effect_key=$4 FOR UPDATE",
        [...workflowParams(lease), key],
      );
      if (existing?.cipher)
        return { cipher: existing.cipher, attempt: existing.attempts };
      if (
        existing?.state === "permanent" &&
        existing.last_code === "permanent_rejection"
      )
        throw new IntegrationFailure("permanent_rejection");
      if (existing && existing.state !== "retryable")
        throw new WorkflowGuardError("effect_outcome_unknown");
      if ((existing?.attempts ?? 0) >= 3)
        throw new WorkflowGuardError("budget_exceeded");
      const {
        rows: [next],
      } = await client.query<{ attempts: number }>(
        `INSERT INTO workflow_effects(tenant_id,actor_id,run_id,effect_key,state)
        VALUES($1,$2,$3,$4,'started') ON CONFLICT(tenant_id,actor_id,run_id,effect_key)
        DO UPDATE SET attempts=workflow_effects.attempts+1,state='started',last_code=NULL,updated_at=clock_timestamp() RETURNING attempts`,
        [...workflowParams(lease), key],
      );
      return { cipher: null, attempt: next!.attempts };
    });
    if (admission.cipher)
      return this.codec.parse(admission.cipher, [
        ...workflowParams(lease),
        "effect",
        key,
      ]) as T;
    try {
      await this.reserve(lease, amount);
      const receipt = createHash("sha256")
        .update(
          JSON.stringify([...workflowParams(lease), key, admission.attempt]),
        )
        .digest("hex");
      const result = await withProviderReceipt(receipt, operation);
      const cipher = this.codec.json(result, [
        ...workflowParams(lease),
        "effect",
        key,
      ]);
      await this.fenced(lease, async (client) => {
        await client.query(
          "UPDATE workflow_effects SET cipher=$5,state='completed',last_code=NULL,updated_at=clock_timestamp() WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND effect_key=$4",
          [...workflowParams(lease), key, cipher],
        );
        await this.checkStateSize(client, lease);
      });
      return result;
    } catch (error) {
      const state =
        error instanceof IntegrationFailure && error.code === "rate_limited"
          ? "retryable"
          : (error instanceof IntegrationFailure &&
                error.code === "permanent_rejection") ||
              error instanceof WorkflowGuardError
            ? "permanent"
            : "ambiguous";
      const code =
        error instanceof IntegrationFailure ||
        error instanceof WorkflowGuardError
          ? error.code
          : "outcome_unknown";
      await this.fenced(lease, async (client) => {
        await client.query(
          "UPDATE workflow_effects SET state=$5,last_code=$6,updated_at=clock_timestamp() WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND effect_key=$4 AND cipher IS NULL",
          [...workflowParams(lease), key, state, code],
        );
      }).catch(() => {});
      throw error;
    }
  }

  async checkStateSize(client: PoolClient, scope: WorkflowScope) {
    const {
      rows: [r],
    } = await client.query<{ bytes: string }>(
      `SELECT COALESCE(sum(bytes),0)::text AS bytes FROM (
      SELECT octet_length(cipher) AS bytes FROM workflow_checkpoints WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 UNION ALL
      SELECT octet_length(cipher) FROM workflow_writes WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 UNION ALL
      SELECT octet_length(cipher) FROM workflow_effects WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3) s`,
      workflowParams(scope),
    );
    if (Number(r?.bytes ?? 0) > 64 * 1024 * 1024)
      throw new WorkflowGuardError("state_limit");
  }

  async finish(
    lease: WorkflowLease,
    status: "completed" | "failed" | "waiting_approval",
    resultId?: string,
    errorCode?: string,
  ) {
    return this.fenced(lease, async (client) => {
      await client.query(
        `UPDATE workflow_runs SET status=$4,result_id=$5,error_code=$6,lease_token=NULL,lease_until=NULL,
        deadline_at=CASE WHEN $4='waiting_approval' THEN expires_at ELSE deadline_at END,updated_at=clock_timestamp()
        WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3`,
        [...workflowParams(lease), status, resultId ?? null, errorCode ?? null],
      );
      if (status === "failed")
        await this.stopLinked(
          client,
          lease,
          "failed",
          errorCode ?? "execution_failed",
        );
      return true;
    });
  }

  async get(scope: WorkflowScope) {
    const r = await this.pool.query<Row>(
      "SELECT * FROM workflow_runs WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND expires_at>clock_timestamp()",
      workflowParams(scope),
    );
    return r.rows[0] ? map(r.rows[0]) : null;
  }
  async list(tenantId: string, kind: WorkflowKind, limit: number) {
    const r = await this.pool.query<Row>(
      "SELECT * FROM workflow_runs WHERE tenant_id=$1 AND kind=$2 AND expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT $3",
      [tenantId, kind, Math.min(50, limit)],
    );
    return r.rows.map(map);
  }

  async approve(scope: WorkflowScope, userId: string) {
    const r = await this.pool.query(
      `UPDATE workflow_runs SET approved_by=$4,status='queued',deadline_at=clock_timestamp()+(budget->>'timeoutMs')::int*interval '1 millisecond',updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND kind='evaluation' AND status='waiting_approval' AND expires_at>clock_timestamp()
      AND EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$4 AND role='owner')`,
      [...workflowParams(scope), userId],
    );
    return r.rowCount === 1;
  }

  async cancel(scope: WorkflowScope) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query<Row>(
        `UPDATE workflow_runs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
        WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND status IN ('queued','running','waiting_approval') RETURNING *`,
        workflowParams(scope),
      );
      if (r.rows[0])
        await this.stopLinked(
          client,
          map(r.rows[0]),
          "cancelled",
          "execution_cancelled",
        );
      await client.query("COMMIT");
      return r.rowCount === 1;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  private async stopLinked(
    client: PoolClient,
    scope: WorkflowScope & { kind: WorkflowKind },
    status: "failed" | "cancelled",
    code: string,
  ) {
    if (scope.kind === "chat")
      await client.query(
        `WITH stopped AS (
      UPDATE chat_runs SET status=$4,last_event_id=last_event_id+1 WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3 AND status='running' RETURNING last_event_id)
      INSERT INTO chat_run_events(tenant_id,actor_id,run_id,event_id,event) SELECT $1,$2,$3,last_event_id,$5::jsonb FROM stopped`,
        [
          ...workflowParams(scope),
          status,
          JSON.stringify(
            status === "cancelled"
              ? { type: "cancelled" }
              : {
                  type: "error",
                  code: "execution_failed",
                  error: "Lumora could not complete this run. Try again.",
                },
          ),
        ],
      );
    if (scope.kind === "ingestion")
      await client.query(
        "UPDATE ingestion_jobs SET status='failed',progress=100,error=$3,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2 AND status IN ('queued','processing')",
        [scope.tenantId, scope.runId, code],
      );
  }
  async prune() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<Row>(
        "SELECT * FROM workflow_runs WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED",
      );
      for (const row of result.rows) {
        if (["queued", "running", "waiting_approval"].includes(row.status))
          await this.stopLinked(
            client,
            map(row),
            "failed",
            "execution_expired",
          );
        await client.query(
          "DELETE FROM workflow_runs WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3",
          workflowParams(map(row)),
        );
      }
      await client.query("COMMIT");
      return result.rows.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
