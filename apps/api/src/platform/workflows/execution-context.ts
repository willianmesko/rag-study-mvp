import {withProviderReceipt,currentProviderReceipt} from "../observability/provider-usage-context.js";
import {observeOperation} from "../observability/observer.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import {
  WorkflowGuardError,
  type Reservation,
  type WorkflowLease,
  type WorkflowRepository,
} from "./types.js";
import { failTransientBudget, reserveTransient, transientSignal } from "./transient-budget.js";

export type ExecutionContext = {
  lease: WorkflowLease;
  repository: WorkflowRepository;
  signal: AbortSignal;
  authorize: () => Promise<boolean>;
  node: string;
  effects: Map<string, Promise<unknown>>;
  publications: { next: number };
  budgetStop?: { controller: AbortController; failure?: WorkflowGuardError };
};
const context = new AsyncLocalStorage<ExecutionContext>();
export const currentExecution = () => context.getStore();
export const withExecution = <T>(
  execution: ExecutionContext,
  work: () => Promise<T>,
) => {
  const budgetStop = execution.budgetStop ?? { controller: new AbortController() };
  return context.run({ ...execution, budgetStop,
    signal: AbortSignal.any([execution.signal, budgetStop.controller.signal]),
  }, work);
};

/** Mark before accounting settles to reject new effects. Abort only after the
 * measured ledger and terminal effect transaction have settled. Durable state
 * is enforced by the repository, not by this per-process cancellation latch. */
export function failExecutionBudget(reason: WorkflowGuardError, abort = false) {
  const execution = currentExecution();
  if (!execution) return failTransientBudget(reason, abort);
  if (!execution.budgetStop) throw new Error("Workflow budget scope is unavailable.");
  execution.budgetStop.failure = reason;
  if (abort) execution.budgetStop.controller.abort(reason);
}

export function workflowNode<T>(name:string,work:()=>Promise<T>):Promise<T>{
  const execution=currentExecution();
  return observeOperation({kind:'workflow.stage',name,runId:execution?.lease.runId,correlationId:execution?.lease.correlationId??execution?.lease.runId,workflowKind:execution?.lease.kind},()=>runWorkflowNode(name,work));
}
async function runWorkflowNode<T>(
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  const execution = currentExecution();
  if (!execution) {
    reserveTransient({ steps: 1 });
    return work();
  }
  if (execution.budgetStop?.failure) throw execution.budgetStop.failure;
  execution.signal.throwIfAborted();
  if (!(await execution.authorize()))
    throw new WorkflowGuardError("authorization_revoked");
  await execution.repository.reserve(execution.lease, { steps: 1 }, name);
  const started = performance.now();
  await execution.repository.event(execution.lease, name, "started");
  return context.run({ ...execution, node: name }, async () => {
    try {
      const result = await work();
      execution.signal.throwIfAborted();
      await execution.repository.event(
        execution.lease,
        name,
        "completed",
        Math.round(performance.now() - started),
      );
      return result;
    } catch (error) {
      await execution.repository
        .event(
          execution.lease,
          name,
          error instanceof Error && error.name === "GraphInterrupt"
            ? "waiting"
            : "failed",
          Math.round(performance.now() - started),
        )
        .catch(() => undefined);
      throw error;
    }
  });
}

/** The request fingerprint is never logged; completed provider results survive node replay. */
export async function workflowEffect<T>(
  name: string,
  request: unknown,
  amount: Reservation,
  work: () => Promise<T>,
): Promise<T> {
  const execution = currentExecution();
  if (execution?.budgetStop?.failure) throw execution.budgetStop.failure;
  const observed=()=>withProviderReceipt(currentProviderReceipt()??createHash("sha256").update(JSON.stringify([name,request])).digest("hex"),()=>observeOperation({kind:/^(chat:|embedding:|judge:|rerank)/.test(name)?'provider.call':'workflow.effect',name,runId:execution?.lease.runId,correlationId:execution?.lease.correlationId??execution?.lease.runId,workflowKind:execution?.lease.kind},work));
  if (!execution) {
    reserveTransient(amount);
    return observed();
  }
  execution.signal.throwIfAborted();
  if (!(await execution.authorize()))
    throw new WorkflowGuardError("authorization_revoked");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([execution.node, name, request]))
    .digest("hex");
  let pending = execution.effects.get(fingerprint) as Promise<T> | undefined;
  if (!pending) {
    pending = execution.repository.effect(
      execution.lease,
      fingerprint,
      amount,
      observed,
    );
    execution.effects.set(fingerprint, pending);
  }
  const result = await pending;
  execution.signal.throwIfAborted();
  return result;
}

export function executionSignal(signal?: AbortSignal): AbortSignal | undefined {
  const failure = currentExecution()?.budgetStop?.failure;
  if (failure) throw failure;
  const active = currentExecution()?.signal ?? transientSignal();
  return active && signal
    ? AbortSignal.any([active, signal])
    : (active ?? signal);
}
