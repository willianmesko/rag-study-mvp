import type { ChatRunEvent } from "@rag-study/contracts";
import type { Pool } from "pg";
import type { ChatRunRepository, ChatRunScope, ChatRunSnapshot, ChatRunStatus } from "../../application/ports/chat-run-repository.js";

const pageSize = 64;
const maxEvents = 512;
const cleanupBatchSize = 250;

const interruptedEvent: ChatRunEvent = {
  type: "error",
  code: "execution_interrupted",
  error: "The answer was interrupted. Ask again to start a new run."
};

const scopeParams = ({ tenantId, actorId, runId }: ChatRunScope) => [tenantId, actorId, runId];

type SnapshotRow = {
  status: ChatRunStatus;
  deadline_reached: boolean;
  event_id: number | null;
  event: ChatRunEvent | null;
};

export class PgChatRunRepository implements ChatRunRepository {
  constructor(private readonly pool: Pool) {}

  async create(scope: ChatRunScope, executionTimeoutMs: number): Promise<boolean> {
    const result = await this.pool.query(
      `WITH inserted AS (
        INSERT INTO chat_runs (tenant_id, actor_id, run_id, deadline_at)
        VALUES ($1, $2, $3, NOW() + ($4::double precision * INTERVAL '1 millisecond'))
        ON CONFLICT (tenant_id, actor_id, run_id) DO NOTHING
        RETURNING tenant_id, actor_id, run_id
      )
      INSERT INTO chat_run_events (tenant_id, actor_id, run_id, event_id, event)
      SELECT tenant_id, actor_id, run_id, 1, '{"type":"accepted"}'::jsonb FROM inserted`,
      [...scopeParams(scope), executionTimeoutMs]
    );
    return result.rowCount === 1;
  }

  async append(scope: ChatRunScope, events: ChatRunEvent[], status?: "completed" | "failed"): Promise<boolean> {
    if (events.length === 0) return false;
    const terminalType = status === "completed" ? "completed" : status === "failed" ? "error" : undefined;
    if (terminalType && events.at(-1)?.type !== terminalType) {
      throw new Error("The final event must match the chat run status.");
    }
    if (events.some((event, index) =>
      (event.type === "completed" || event.type === "error" || event.type === "cancelled")
      && (index !== events.length - 1 || event.type !== terminalType))) {
      throw new Error("Terminal chat events can only be appended with their state transition.");
    }
    // The run row serializes event numbering and the running-state predicate
    // ensures a worker cannot publish anything after cancellation or expiry.
    const result = await this.pool.query(
      `WITH advanced AS (
        UPDATE chat_runs
        SET last_event_id = last_event_id + $4::integer, status = COALESCE($5, status)
        WHERE tenant_id = $1 AND actor_id = $2 AND run_id = $3 AND status = 'running'
          AND deadline_at > clock_timestamp() AND expires_at > NOW()
          AND last_event_id + $4::integer <= $6
        RETURNING tenant_id, actor_id, run_id, last_event_id - $4::integer AS previous_event_id
      )
      INSERT INTO chat_run_events (tenant_id, actor_id, run_id, event_id, event)
      SELECT advanced.tenant_id, advanced.actor_id, advanced.run_id,
        (advanced.previous_event_id + item.position)::integer, item.event
      FROM advanced CROSS JOIN jsonb_array_elements($7::jsonb) WITH ORDINALITY AS item(event, position)`,
      [...scopeParams(scope), events.length, status ?? null, status ? maxEvents : maxEvents - 1, JSON.stringify(events)]
    );
    return result.rowCount === events.length;
  }

  async cancel(scope: ChatRunScope): Promise<ChatRunStatus | null> {
    const changed = await this.terminate(scope, "cancelled", { type: "cancelled" });
    return changed ? "cancelled" : this.get(scope);
  }

  async get(scope: ChatRunScope): Promise<ChatRunStatus | null> {
    const result = await this.pool.query<{ status: ChatRunStatus }>(
      `SELECT CASE WHEN status = 'running' AND deadline_at <= NOW() THEN 'failed' ELSE status END AS status
       FROM chat_runs WHERE tenant_id = $1 AND actor_id = $2 AND run_id = $3 AND expires_at > NOW()`,
      scopeParams(scope)
    );
    return result.rows[0]?.status ?? null;
  }

  async read(scope: ChatRunScope, after: number): Promise<ChatRunSnapshot | null> {
    let rows = await this.readPage(scope, after);
    if (rows[0]?.status === "running" && rows[0].deadline_reached) {
      await this.terminate(scope, "failed", interruptedEvent);
      rows = await this.readPage(scope, after);
    }
    const run = rows[0];
    if (!run) return null;
    return {
      status: run.status,
      events: rows.flatMap(({ event_id, event }) => event_id !== null && event !== null ? [{ id: event_id, event }] : [])
    };
  }

  private async readPage(scope: ChatRunScope, after: number): Promise<SnapshotRow[]> {
    const result = await this.pool.query<SnapshotRow>(
      `SELECT r.status, r.deadline_at <= NOW() AS deadline_reached, e.event_id, e.event
       FROM chat_runs r
       LEFT JOIN LATERAL (
         SELECT event_id, event FROM chat_run_events
         WHERE tenant_id = r.tenant_id AND actor_id = r.actor_id AND run_id = r.run_id AND event_id > $4
         ORDER BY event_id LIMIT $5
       ) e ON TRUE
       WHERE r.tenant_id = $1 AND r.actor_id = $2 AND r.run_id = $3 AND r.expires_at > NOW()
       ORDER BY e.event_id`,
      [...scopeParams(scope), after, pageSize]
    );
    return result.rows;
  }

  private async terminate(scope: ChatRunScope, status: "cancelled" | "failed", event: ChatRunEvent): Promise<boolean> {
    const result = await this.pool.query(
      `WITH stopped AS (
        UPDATE chat_runs SET status = $4, last_event_id = last_event_id + 1
        WHERE tenant_id = $1 AND actor_id = $2 AND run_id = $3 AND status = 'running' AND expires_at > NOW()
          AND (CASE WHEN $4 = 'failed' THEN deadline_at <= clock_timestamp() ELSE deadline_at > clock_timestamp() END)
        RETURNING tenant_id, actor_id, run_id, last_event_id
      )
      INSERT INTO chat_run_events (tenant_id, actor_id, run_id, event_id, event)
      SELECT tenant_id, actor_id, run_id, last_event_id, $5::jsonb FROM stopped`,
      [...scopeParams(scope), status, JSON.stringify(event)]
    );
    return result.rowCount === 1;
  }

  async pruneExpired(): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM chat_runs AS r USING (
        SELECT tenant_id, actor_id, run_id FROM chat_runs WHERE expires_at <= NOW()
        ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED
      ) AS expired
      WHERE r.tenant_id = expired.tenant_id AND r.actor_id = expired.actor_id AND r.run_id = expired.run_id`,
      [cleanupBatchSize]
    );
    return result.rowCount ?? 0;
  }
}
