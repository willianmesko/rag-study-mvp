import type { CreateEvaluationRun } from "../../../evaluations/index.js";
import type { AgentActionReason } from "./agent-action-service.js";

export const agentActionAttemptLimit = 3;
const attemptTimeoutMs = 10_000;
const leaseDurationMs = 15_000;

export type AgentActionLease = { actionId: string; tenantId: string; leaseId: string; attempt: number };
export type AgentActionFailure = Extract<AgentActionReason, "read_failed" | "execution_timeout" | "worker_shutdown" | "lease_expired">;

export interface AgentActionWorkerRepository {
  claim(leaseMs: number): Promise<AgentActionLease | null>;
  complete(lease: AgentActionLease, result: CreateEvaluationRun): Promise<void>;
  fail(lease: AgentActionLease, reason: AgentActionFailure): Promise<void>;
}

export interface AgentActionHandler {
  prepare(tenantId: string, signal: AbortSignal): Promise<CreateEvaluationRun>;
}

export class AgentActionWorker {
  constructor(private readonly repository: AgentActionWorkerRepository, private readonly handler: AgentActionHandler) {}

  async runNext({ signal: parentSignal }: { signal?: AbortSignal } = {}): Promise<boolean> {
    parentSignal?.throwIfAborted();
    const lease = await this.repository.claim(leaseDurationMs);
    if (!lease) return false;

    const deadline = AbortSignal.timeout(attemptTimeoutMs);
    const signal = parentSignal ? AbortSignal.any([deadline, parentSignal]) : deadline;
    let result: CreateEvaluationRun;
    try {
      signal.throwIfAborted();
      result = await this.handler.prepare(lease.tenantId, signal);
      signal.throwIfAborted();
    } catch {
      await this.repository.fail(lease, parentSignal?.aborted ? "worker_shutdown" : deadline.aborted ? "execution_timeout" : "read_failed");
      return true;
    }

    // Keep effect and final state in the same transaction. If the response
    // from PostgreSQL is lost, lease recovery checks the committed state.
    await this.repository.complete(lease, result);
    return true;
  }
}
