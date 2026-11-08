import {
  questionInputSchema,
  questionComparisonInputSchema,
  type QuestionInput,
  type QuestionComparisonInput,
  type QuestionComparisonResponse,
} from "@rag-study/contracts";
import type {
  ConversationRepository,
  ConversationSubmission,
  PendingConversationSubmission,
} from "../ports/conversation-repository.js";
import type { ChatRunRepository } from "../ports/chat-run-repository.js";
import { withExecutionTimeout } from "../../../mcp/index.js";

function decodeRecoveredSubmission(item: PendingConversationSubmission): ConversationSubmission | null {
  if (item.mode === "answer") {
    const parsed = questionInputSchema.safeParse(item.input);
    return parsed.success ? { ...item, mode: "answer", input: parsed.data } : null;
  }
  if (item.mode === "comparison") {
    const parsed = questionComparisonInputSchema.safeParse(item.input);
    return parsed.success ? { ...item, mode: "comparison", input: parsed.data } : null;
  }
  return null;
}

/** The persisted turn is an outbox. Admission retries never create another turn. */
export class ConversationDelivery {
  private readonly active = new Set<Promise<void>>();
  constructor(
    private readonly records: Pick<ConversationRepository, "admit" | "pending" | "pruneExpired" | "fail" | "claimComparison" | "turn" | "completeComparison">,
    private readonly runs: Pick<ChatRunRepository, "get">,
    private readonly startAnswer: (
      submission: ConversationSubmission & { input: QuestionInput },
    ) => Promise<void>,
    private readonly compare: (
      submission: ConversationSubmission & { input: QuestionComparisonInput },
      signal: AbortSignal,
    ) => Promise<QuestionComparisonResponse>,
    private readonly shutdown: AbortSignal,
    private readonly timeoutMs: number,
    private readonly report: (reason: string) => void,
  ) {}

  async submit(submission: ConversationSubmission) {
    const turn = await this.records.admit(submission);
    if (turn.status === "queued")
      await this.deliver({ ...submission, input: turn.input });
    return turn;
  }
  async recover() {
    await this.records.pruneExpired();
    for (const item of await this.records.pending(10)) {
      if (this.shutdown.aborted) return;
      const submission = decodeRecoveredSubmission(item);
      if (!submission) {
        await this.records.fail(item, item.runId);
        this.report("conversation_recovery_invalid_input");
        continue;
      }
      await this.deliver(submission);
    }
  }
  async close() {
    await Promise.allSettled([...this.active]);
  }
  private async deliver(submission: ConversationSubmission) {
    if (this.shutdown.aborted) return;
    if (submission.mode === "answer") {
      const scope = {
        tenantId: submission.tenantId,
        actorId: submission.userId,
        runId: submission.runId,
        conversationId: submission.conversationId,
      };
      if (await this.runs.get(scope)) return;
      try {
        await this.startAnswer({
          ...submission,
          input: submission.input as QuestionInput,
        });
      } catch {
        // Another dispatcher may already have committed the same admission.
        if (!(await this.runs.get(scope))) {
          await this.records.fail(submission, submission.runId);
          this.report("conversation_admission_failed");
        }
      }
      return;
    }
    if (
      !(await this.records.claimComparison(
        submission,
        submission.runId,
        this.timeoutMs + 5000,
      ))
    )
      return;
    const task = this.runComparison(submission).catch(() =>
      this.report("conversation_comparison_failed"),
    );
    this.active.add(task);
    void task.finally(() => this.active.delete(task));
  }
  private async runComparison(submission: ConversationSubmission) {
    const revoked = new AbortController();
    let checking = false;
    const signal = AbortSignal.any([this.shutdown, revoked.signal]);
    const timer = setInterval(() => {
      if (checking || signal.aborted) return;
      checking = true;
      void this.records
        .turn(submission, submission.runId)
        .then((turn) => {
          if (!turn || turn.status !== "running") revoked.abort();
        })
        .catch(() => revoked.abort())
        .finally(() => {
          checking = false;
        });
    }, 500);
    timer.unref();
    try {
      const result = await withExecutionTimeout(
        (bounded) =>
          this.compare(
            {
              ...submission,
              input: submission.input as QuestionComparisonInput,
            },
            bounded,
          ),
        this.timeoutMs,
        signal,
      );
      signal.throwIfAborted();
      await this.records.completeComparison(
        submission,
        submission.runId,
        result,
      );
    } catch {
      await this.records.fail(submission, submission.runId);
    } finally {
      clearInterval(timer);
      revoked.abort();
    }
  }
}
