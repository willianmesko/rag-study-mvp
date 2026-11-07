import { setTimeout as delay } from "node:timers/promises";
import type { ChatRunEvent, QuestionResponse } from "@rag-study/contracts";
import type { ChatRunRepository, ChatRunScope } from "../ports/chat-run-repository.js";

type Execution = {
  reserveQuota: () => Promise<boolean>;
  answer: (input: { signal: AbortSignal; publish: (event: ChatRunEvent) => Promise<void> }) => Promise<QuestionResponse>;
  reportFailure: (error: unknown) => void;
};

const interrupted = { type: "error", code: "execution_interrupted", error: "The answer was interrupted. You can ask again." } as const;
const failed = { type: "error", code: "execution_failed", error: "Lumora could not prepare an answer. Try again." } as const;
const quotaExceeded = { type: "error", code: "quota_exceeded", error: "Daily question quota reached. Try again tomorrow." } as const;

function runKey({ tenantId, actorId, runId }: ChatRunScope): string {
  return `${tenantId}:${actorId}:${runId}`;
}

export class StreamAnswerRuns {
  private readonly shutdown = new AbortController();
  private readonly active = new Map<string, { controller: AbortController; task: Promise<void> }>();

  constructor(private readonly repository: ChatRunRepository, private readonly executionTimeoutMs: number) {}

  async start(scope: ChatRunScope, execution: Execution): Promise<void> {
    this.shutdown.signal.throwIfAborted();
    // Leave a short window to persist the timeout event after the work stops.
    const created = await this.repository.create(scope, this.executionTimeoutMs + 5_000);
    if (!created) return;
    const controller = new AbortController();
    const key = runKey(scope);
    const task = this.execute(scope, execution, controller)
      .catch(execution.reportFailure)
      .finally(() => this.active.delete(key));
    this.active.set(key, { controller, task });
  }

  async cancel(scope: ChatRunScope) {
    const status = await this.repository.cancel(scope);
    if (status === "cancelled") this.active.get(runKey(scope))?.controller.abort();
    return status;
  }

  async close(): Promise<void> {
    this.shutdown.abort();
    await Promise.allSettled(Array.from(this.active.values(), ({ task }) => task));
  }

  private async execute(scope: ChatRunScope, execution: Execution, controller: AbortController): Promise<void> {
    const signal = AbortSignal.any([controller.signal, this.shutdown.signal, AbortSignal.timeout(this.executionTimeoutMs)]);
    const monitor = this.monitor(scope, signal, controller, execution.reportFailure);
    const publish = async (event: ChatRunEvent) => {
      signal.throwIfAborted();
      if (!await this.repository.append(scope, [event])) controller.abort();
      signal.throwIfAborted();
    };
    try {
      signal.throwIfAborted();
      const allowed = await execution.reserveQuota();
      signal.throwIfAborted();
      if (!allowed) {
        await this.repository.append(scope, [quotaExceeded], "failed");
        return;
      }
      const response = await execution.answer({ signal, publish });
      signal.throwIfAborted();
      await this.repository.append(scope, [{ type: "completed", response }], "completed");
    } catch (error) {
      if (!signal.aborted) execution.reportFailure(error);
      // A concurrent stop already owns the terminal event. An interrupted
      // worker can only record a failure while the run is still active.
      await this.repository.append(scope, [signal.aborted ? interrupted : failed], "failed");
    } finally {
      controller.abort();
      await monitor;
    }
  }

  private async monitor(scope: ChatRunScope, signal: AbortSignal, controller: AbortController, reportFailure: Execution["reportFailure"]) {
    try {
      while (!signal.aborted) {
        await delay(1_000, undefined, { signal });
        if (await this.repository.get(scope) !== "running") controller.abort();
      }
    } catch (error) {
      if (!signal.aborted) {
        reportFailure(error);
        controller.abort();
      }
    }
  }
}
