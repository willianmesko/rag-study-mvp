import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { traceable } from "langsmith/traceable";
import { withExecution } from "../../application/workflows/execution-context.js";
import {
  WorkflowApprovalPending,
  WorkflowGuardError,
  type WorkflowAdmission,
  type WorkflowKind,
  type WorkflowLease,
  type WorkflowRepository,
  type WorkflowScope,
  type WorkflowHandler,
} from "../../application/workflows/types.js";
import { withGraphPersistence } from "./graph-execution.js";

/** Fixed registered definitions are the only executable actions; client input cannot name code or tools. */
export class DurableWorkflowRunner {
  private readonly handlers = new Map<WorkflowKind, WorkflowHandler>();
  private readonly active = new Map<
    string,
    { controller: AbortController; task: Promise<void>; kind: WorkflowKind }
  >();
  private timer?: ReturnType<typeof setInterval>;
  private polling?: Promise<void>;
  private closing = false;
  constructor(
    readonly repository: WorkflowRepository,
    private readonly saver: (
      lease: WorkflowLease,
      graph: string,
    ) => BaseCheckpointSaver,
    private readonly failure: (code: string) => void = () => undefined,
  ) {}

  register(kind: WorkflowKind, handler: WorkflowHandler) {
    if (this.timer || this.handlers.has(kind))
      throw new Error(
        "Workflow definitions must be registered once before startup.",
      );
    this.handlers.set(kind, handler);
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.kick(), 1_000);
    this.timer.unref();
    this.kick();
  }
  private kick() {
    if (this.closing || this.polling) return;
    this.polling = this.poll()
      .catch(() => this.failure("workflow_poll_failed"))
      .finally(() => {
        this.polling = undefined;
      });
  }
  async submit(input: WorkflowAdmission) {
    const handler = this.handlers.get(input.kind);
    if (!handler || handler.version !== input.version)
      throw new WorkflowGuardError("definition_changed");
    const result = await this.repository.admit(input);
    this.kick();
    return result;
  }
  async cancel(scope: WorkflowScope) {
    const changed = await this.repository.cancel(scope);
    if (changed)
      this.active
        .get(this.key(scope))
        ?.controller.abort(new WorkflowGuardError("cancelled"));
    return changed;
  }
  private key(scope: WorkflowScope) {
    return JSON.stringify([scope.tenantId, scope.actorId, scope.runId]);
  }
  private async poll() {
    while (!this.closing && this.active.size < 3) {
      const kinds = [...this.handlers.keys()].filter(
        (kind) =>
          kind === "chat" ||
          ![...this.active.values()].some((active) => active.kind === kind),
      );
      const lease = await this.repository.claim(kinds);
      if (!lease) return;
      if (this.closing) {
        await this.repository.release(lease);
        return;
      }
      const controller = new AbortController();
      const key = this.key(lease);
      const task = this.execute(lease, controller)
        .catch(() => this.failure("workflow_execution_failed"))
        .finally(() => this.active.delete(key));
      this.active.set(key, { controller, task, kind: lease.kind });
    }
  }
  private async execute(lease: WorkflowLease, controller: AbortController) {
    const handler = this.handlers.get(lease.kind);
    const deadline = AbortSignal.timeout(
      Math.max(1, lease.deadlineAt.getTime() - Date.now()),
    );
    const signal = AbortSignal.any([controller.signal, deadline]);
    let heartbeat: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (heartbeat) return;
      heartbeat = this.repository
        .heartbeat(lease)
        .then((valid) => {
          if (!valid) controller.abort(new WorkflowGuardError("lease_lost"));
        })
        .catch(() => controller.abort(new WorkflowGuardError("lease_lost")))
        .finally(() => {
          heartbeat = undefined;
        });
    }, 2_000);
    try {
      if (!handler || handler.version !== lease.version)
        throw new WorkflowGuardError("definition_changed");
      if (lease.attempts > 8) throw new WorkflowGuardError("budget_exceeded");
      signal.throwIfAborted();
      if (!(await handler.authorize(lease)))
        throw new WorkflowGuardError("authorization_revoked");
      const result = await withExecution(
        {
          lease,
          repository: this.repository,
          signal,
          authorize: () => handler.authorize(lease),
          node: "admission",
          effects: new Map(),
          publications: { next: 0 },
        },
        () =>
          traceable(
            () =>
              withGraphPersistence(
                {
                  createSaver: (graph) => this.saver(lease, graph),
                  runId: lease.runId,
                  approved: lease.approvedBy !== null,
                },
                () => handler.run(lease, signal),
              ),
            { tracingEnabled: false },
          )(),
      );
      signal.throwIfAborted();
      await this.repository.finish(
        lease,
        result.waiting ? "waiting_approval" : "completed",
        result.resultId,
      );
    } catch (error) {
      if (error instanceof WorkflowApprovalPending)
        await this.repository.finish(lease, "waiting_approval");
      else if (this.closing) await this.repository.release(lease);
      else {
        const code =
          error instanceof WorkflowGuardError
            ? error.code
            : deadline.aborted
              ? "deadline_exceeded"
              : "execution_failed";
        await this.repository
          .finish(lease, "failed", undefined, code)
          .catch(() => undefined);
        this.failure(code);
      }
    } finally {
      clearInterval(timer);
      await heartbeat;
    }
  }
  async close() {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    for (const { controller } of this.active.values())
      controller.abort(new Error("Worker shutdown."));
    await this.polling;
    await Promise.allSettled([...this.active.values()].map(({ task }) => task));
  }
}
