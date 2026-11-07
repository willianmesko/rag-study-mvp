import { z } from "zod";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  conversationTurnSchema,
  questionComparisonResponseSchema,
  type ConversationSummary,
  type ConversationTurn,
  type QuestionComparisonResponse,
} from "@rag-study/contracts";
import {
  ConversationError,
  type ConversationOwner,
  type ConversationScope,
  type ConversationRepository,
  type ConversationSubmission,
} from "../../application/ports/conversation-repository.js";
import { redactPii } from "../../domain/security/pii-redaction.js";

const member = `EXISTS(SELECT 1 FROM tenant_memberships m WHERE m.tenant_id=c.tenant_id AND m.user_id=c.owner_id)`;
const visible = `c.tenant_id=$1 AND c.owner_id=$2 AND c.expires_at>clock_timestamp() AND ${member}`;
const summary = `c.id,c.title,c.next_sequence-1 AS "turnCount",c.created_at AS "createdAt",c.updated_at AS "updatedAt",c.expires_at AS "expiresAt"`;
const params = (scope: ConversationOwner) => [scope.tenantId, scope.userId];
type SummaryRow = Omit<
  ConversationSummary,
  "createdAt" | "updatedAt" | "expiresAt"
> & { createdAt: Date; updatedAt: Date; expiresAt: Date };
const summaryView = (row: SummaryRow): ConversationSummary => ({
  id: row.id,
  title: row.title,
  turnCount: row.turnCount,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
});
type TurnRow = {
  run_id: string;
  user_message_id: string;
  assistant_message_id: string;
  conversation_id: string;
  sequence: number;
  mode: "answer" | "comparison";
  status: ConversationTurn["status"];
  input: ConversationTurn["input"];
  response: unknown;
  feedback: "up" | "down" | null;
  failure_code: string | null;
  created_at: Date;
  completed_at: Date | null;
};
const turnView = (row: TurnRow): ConversationTurn =>
  conversationTurnSchema.parse({
    runId: row.run_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    conversationId: row.conversation_id,
    sequence: row.sequence,
    mode: row.mode,
    status: row.status,
    question: row.input.question,
    input: row.input,
    answer: row.mode === "answer" ? row.response : null,
    comparison: row.mode === "comparison" ? row.response : null,
    feedback: row.feedback,
    failureCode: row.failure_code,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  });

export class PgConversationRepository implements ConversationRepository {
  constructor(private readonly pool: Pool) {}
  create(owner: ConversationOwner, id: string, title?: string) {
    return this.transaction(async (db) => {
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('conversations:'||$1::text||':'||$2::text,0))",
        params(owner),
      );
      const count = await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM conversations WHERE tenant_id=$1 AND owner_id=$2 AND expires_at>clock_timestamp()",
        params(owner),
      );
      const old = await db.query<SummaryRow>(
        `SELECT ${summary} FROM conversations c WHERE ${visible} AND c.id=$3`,
        [...params(owner), id],
      );
      if (old.rows[0]) return summaryView(old.rows[0]);
      if (count.rows[0]!.n >= 100)
        throw new ConversationError("conversation_limit", 409);
      const result = await db.query<SummaryRow>(
        `INSERT INTO conversations AS c(tenant_id,owner_id,id,title)
        SELECT $1,$2,$3,$4 FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 ON CONFLICT DO NOTHING RETURNING ${summary}`,
        [...params(owner), id, title ?? null],
      );
      if (!result.rows[0])
        throw new ConversationError("conversation_unavailable", 404);
      return summaryView(result.rows[0]);
    });
  }
  async list(owner: ConversationOwner, limit: number, cursor?: string) {
    let boundary: { at: string; id: string } | null = null;
    if (cursor) {
      try {
        boundary = z
          .strictObject({ at: z.iso.datetime(), id: z.uuid() })
          .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
      } catch {
        throw new ConversationError("conversation_unavailable", 400);
      }
    }
    const { rows } = await this.pool.query<SummaryRow & { cursor_at: string }>(
      `SELECT ${summary},to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM conversations c WHERE ${visible}
      AND ($3::timestamptz IS NULL OR (c.created_at,c.id)<($3::timestamptz,$4::uuid)) ORDER BY c.created_at DESC,c.id DESC LIMIT $5`,
      [...params(owner), boundary?.at ?? null, boundary?.id ?? null, limit + 1],
    );
    const page = rows.slice(0, limit),
      last = page.at(-1);
    return {
      conversations: page.map(summaryView),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ at: last.cursor_at, id: last.id }),
            ).toString("base64url")
          : null,
    };
  }
  async messages(scope: ConversationScope, limit: number, before?: number) {
    return this.transaction(async (db) => {
      const row = await this.authorize(db, scope);
      const { rows } = await db.query<TurnRow>(
        `SELECT t.* FROM conversation_turns t WHERE tenant_id=$1 AND owner_id=$2 AND conversation_id=$3
        AND ($4::int IS NULL OR sequence<$4) ORDER BY sequence DESC LIMIT $5`,
        [...params(scope), scope.conversationId, before ?? null, limit + 1],
      );
      const page = rows.slice(0, limit);
      return {
        conversation: summaryView(row),
        turns: page.reverse().map(turnView),
        nextBefore: rows.length > limit ? page[0]!.sequence : null,
      };
    });
  }
  async rename(scope: ConversationScope, title: string) {
    const { rows } = await this.pool.query<SummaryRow>(
      `UPDATE conversations c SET title=$4,updated_at=clock_timestamp() WHERE ${visible} AND c.id=$3 RETURNING ${summary}`,
      [...params(scope), scope.conversationId, title],
    );
    if (!rows[0]) throw new ConversationError("conversation_unavailable", 404);
    return summaryView(rows[0]);
  }
  async delete(scope: ConversationScope) {
    await this.pool.query(
      `DELETE FROM conversations c WHERE c.tenant_id=$1 AND c.owner_id=$2 AND ${member} AND c.id=$3`,
      [...params(scope), scope.conversationId],
    );
  }
  async deleteAll(owner: ConversationOwner) {
    await this.pool.query(
      `DELETE FROM conversations c WHERE c.tenant_id=$1 AND c.owner_id=$2 AND ${member}`,
      params(owner),
    );
  }
  async feedback(
    scope: ConversationScope,
    id: string,
    value: "up" | "down" | null,
  ) {
    const result = await this.pool.query(
      `UPDATE conversation_turns t SET feedback=$5 FROM conversations c
      WHERE ${visible} AND c.id=$3 AND t.tenant_id=c.tenant_id AND t.owner_id=c.owner_id AND t.conversation_id=c.id
        AND t.assistant_message_id=$4 AND t.status='completed'`,
      [...params(scope), scope.conversationId, id, value],
    );
    if (!result.rowCount)
      throw new ConversationError("feedback_unavailable", 404);
  }
  admit(submission: ConversationSubmission) {
    return this.transaction(async (db) => {
      const c = await this.authorize(db, submission, true);
      const request = { ...submission.input };
      delete (request as { previousQuestions?: unknown }).previousQuestions;
      const hash = createHash("sha256")
        .update(
          JSON.stringify([
            submission.mode,
            request.question,
            request.topK ?? 5,
            "modelIds" in request
              ? request.modelIds
              : (request.modelId ?? null),
            "promptVariantIds" in request
              ? (request.promptVariantIds ?? null)
              : null,
          ]),
        )
        .digest();
      const {
        rows: [old],
      } = await db.query<TurnRow & { request_hash: Buffer }>(
        "SELECT * FROM conversation_turns WHERE tenant_id=$1 AND owner_id=$2 AND run_id=$3",
        [...params(submission), submission.runId],
      );
      if (old) {
        if (
          old.conversation_id !== submission.conversationId ||
          !old.request_hash.equals(hash)
        )
          throw new ConversationError("idempotency_conflict", 409);
        return turnView(old);
      }
      const existingExecution = await db.query(
        `SELECT 1 FROM chat_runs WHERE tenant_id=$1 AND actor_id=$2 AND run_id=$3
         UNION ALL SELECT 1 FROM workflow_runs WHERE tenant_id=$1 AND actor_user_id=$2 AND run_id=$3 LIMIT 1`,
        [...params(submission), submission.runId],
      );
      if (existingExecution.rowCount)
        throw new ConversationError("idempotency_conflict", 409);
      if (c.turnCount >= 500) throw new ConversationError("message_limit", 409);
      const active = await db.query(
        "SELECT 1 FROM conversation_turns WHERE tenant_id=$1 AND owner_id=$2 AND conversation_id=$3 AND status IN ('queued','running')",
        [...params(submission), submission.conversationId],
      );
      if (active.rowCount)
        throw new ConversationError("conversation_busy", 409);
      const { rows: previous } = await db.query<{ question: string }>(
        `SELECT input->>'question' AS question FROM conversation_turns
        WHERE tenant_id=$1 AND owner_id=$2 AND conversation_id=$3 AND mode='answer' AND status='completed'
          AND coalesce(response->>'refusalReason','')='' ORDER BY sequence DESC LIMIT 3`,
        [...params(submission), submission.conversationId],
      );
      const context = previous
        .reverse()
        .map(({ question }) => question.slice(0, 500).trim())
        .filter(Boolean);
      const canonical = {
        ...request,
        ...(submission.mode === "answer" && context.length
          ? { previousQuestions: context }
          : {}),
      };
      const title =
        redactPii(request.question)
          .text.replace(/[\p{Cc}\p{Cf}]/gu, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80) || "Conversation";
      const {
        rows: [turn],
      } = await db.query<TurnRow>(
        `INSERT INTO conversation_turns(tenant_id,owner_id,conversation_id,run_id,sequence,mode,request_hash,input)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
        [
          ...params(submission),
          submission.conversationId,
          submission.runId,
          c.turnCount + 1,
          submission.mode,
          hash,
          JSON.stringify(canonical),
        ],
      );
      await db.query(
        `UPDATE conversations SET next_sequence=next_sequence+1,title=coalesce(title,$4),updated_at=clock_timestamp(),expires_at=clock_timestamp()+interval '90 days'
        WHERE tenant_id=$1 AND owner_id=$2 AND id=$3`,
        [...params(submission), submission.conversationId, title],
      );
      return turnView(turn!);
    });
  }
  async pending(limit: number) {
    const { rows } = await this.pool.query<
      TurnRow & { tenant_id: string; owner_id: string }
    >(
      `SELECT t.* FROM conversation_turns t JOIN conversations c
      ON c.tenant_id=t.tenant_id AND c.owner_id=t.owner_id AND c.id=t.conversation_id
      WHERE t.status='queued' AND t.deadline_at>clock_timestamp() AND c.expires_at>clock_timestamp() AND ${member}
        AND NOT EXISTS(SELECT 1 FROM chat_runs r WHERE r.tenant_id=t.tenant_id AND r.actor_id=t.owner_id AND r.run_id=t.run_id)
      ORDER BY t.created_at LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      userId: row.owner_id,
      conversationId: row.conversation_id,
      runId: row.run_id,
      mode: row.mode,
      input: row.input,
    }));
  }
  async turn(scope: ConversationScope, runId: string) {
    const { rows } = await this.pool.query<TurnRow>(
      `SELECT t.* FROM conversation_turns t JOIN conversations c
      ON c.tenant_id=t.tenant_id AND c.owner_id=t.owner_id AND c.id=t.conversation_id WHERE ${visible} AND c.id=$3 AND t.run_id=$4`,
      [...params(scope), scope.conversationId, runId],
    );
    return rows[0] ? turnView(rows[0]) : null;
  }
  async fail(scope: ConversationScope, runId: string) {
    await this.pool.query(
      `UPDATE conversation_turns t SET status='failed',failure_code='execution_failed',completed_at=clock_timestamp(),updated_at=clock_timestamp()
      FROM conversations c WHERE ${visible} AND c.id=$3 AND t.tenant_id=c.tenant_id AND t.owner_id=c.owner_id AND t.conversation_id=c.id AND t.run_id=$4
        AND t.status IN ('queued','running')`,
      [...params(scope), scope.conversationId, runId],
    );
  }
  async claimComparison(
    scope: ConversationScope,
    runId: string,
    timeoutMs: number,
  ) {
    const result = await this.pool.query(
      `UPDATE conversation_turns t SET status='running',updated_at=clock_timestamp(),deadline_at=clock_timestamp()+$5::int*interval '1 millisecond'
      FROM conversations c WHERE ${visible} AND c.id=$3 AND t.tenant_id=c.tenant_id AND t.owner_id=c.owner_id AND t.conversation_id=c.id AND t.run_id=$4
        AND t.status='queued' AND t.mode='comparison' RETURNING t.run_id`,
      [...params(scope), scope.conversationId, runId, timeoutMs],
    );
    return result.rowCount === 1;
  }
  async completeComparison(
    scope: ConversationScope,
    runId: string,
    response: QuestionComparisonResponse,
  ) {
    const parsed = questionComparisonResponseSchema.parse(response);
    for (const { response: answer } of parsed.results) {
      if (
        answer?.citedChunkIds?.some(
          (id) => !answer.sources.some((source) => source.chunkId === id),
        )
      )
        throw new ConversationError("conversation_unavailable", 409);
    }
    return this.transaction(async (db) => {
      await this.authorize(db, scope);
      const sources = parsed.results.flatMap(({ response }) =>
        response
          ? [...response.sources, ...(response.contextSources ?? [])]
          : [],
      );
      for (const source of sources) {
        const valid = await db.query(
          "SELECT 1 FROM chunks c JOIN documents d ON d.id=c.document_id WHERE d.tenant_id=$1 AND c.id::text=$2 AND d.id::text=$3 FOR SHARE OF c,d",
          [scope.tenantId, source.chunkId, source.documentId],
        );
        if (!valid.rowCount)
          throw new ConversationError("conversation_unavailable", 409);
      }
      const result = await db.query(
        `UPDATE conversation_turns SET status='completed',response=$5::jsonb,completed_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE tenant_id=$1 AND owner_id=$2 AND conversation_id=$3 AND run_id=$4 AND status='running' AND deadline_at>clock_timestamp()`,
        [...params(scope), scope.conversationId, runId, JSON.stringify(parsed)],
      );
      return result.rowCount === 1;
    });
  }
  async cancelPending(scope: ConversationScope, runId: string) {
    await this.pool.query(
      `UPDATE conversation_turns t SET status='cancelled',completed_at=clock_timestamp()
    FROM conversations c WHERE ${visible} AND c.id=$3 AND t.tenant_id=c.tenant_id AND t.owner_id=c.owner_id AND t.conversation_id=c.id AND t.run_id=$4
      AND t.status IN ('queued','running') AND (t.mode='comparison' OR NOT EXISTS(SELECT 1 FROM chat_runs r WHERE r.tenant_id=t.tenant_id AND r.actor_id=t.owner_id AND r.run_id=t.run_id))`,
      [...params(scope), scope.conversationId, runId],
    );
  }
  async pruneExpired() {
    await this.pool
      .query(`UPDATE conversation_turns t SET status='failed',failure_code='execution_interrupted',completed_at=clock_timestamp()
      WHERE t.status IN ('queued','running') AND t.deadline_at<=clock_timestamp()
        AND NOT EXISTS(SELECT 1 FROM chat_runs r WHERE r.tenant_id=t.tenant_id AND r.actor_id=t.owner_id AND r.run_id=t.run_id AND r.status='running' AND r.deadline_at>clock_timestamp())`);
    const result = await this.pool
      .query(`DELETE FROM conversations c USING(SELECT tenant_id,owner_id,id FROM conversations WHERE expires_at<=clock_timestamp()
      ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED) expired WHERE c.tenant_id=expired.tenant_id AND c.owner_id=expired.owner_id AND c.id=expired.id`);
    return result.rowCount ?? 0;
  }
  private async authorize(
    db: PoolClient,
    scope: ConversationScope,
    write = false,
  ) {
    const { rows } = await db.query<SummaryRow>(
      `SELECT ${summary} FROM conversations c WHERE ${visible} AND c.id=$3 ${write ? "FOR UPDATE" : "FOR SHARE"}`,
      [...params(scope), scope.conversationId],
    );
    if (!rows[0]) throw new ConversationError("conversation_unavailable", 404);
    return rows[0];
  }
  private async transaction<T>(
    task: (db: PoolClient) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL statement_timeout='4s'");
      const result = await task(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      )
        throw new ConversationError("idempotency_conflict", 409);
      throw error;
    } finally {
      db.release();
    }
  }
}
