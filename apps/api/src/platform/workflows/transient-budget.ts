import { AsyncLocalStorage } from "node:async_hooks";
import {
  WorkflowGuardError,
  type Reservation,
  type WorkflowBudget,
} from "./types.js";

type Meter = {
  budget: WorkflowBudget;
  steps: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  signal: AbortSignal;
  stop: AbortController;
  failure?: WorkflowGuardError;
};
const meters = new AsyncLocalStorage<Meter>();
export function withTransientBudget<T>(
  budget: WorkflowBudget,
  work: () => Promise<T>,
): Promise<T> {
  const existing = meters.getStore();
  if (existing?.failure) throw existing.failure;
  if (existing) return work();
  const stop = new AbortController();
  return meters.run(
    {
      budget,
      steps: 0,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
      signal: AbortSignal.any([AbortSignal.timeout(budget.timeoutMs), stop.signal]),
      stop,
    },
    work,
  );
}
export const transientSignal = () => {
  const meter = meters.getStore();
  if (meter?.failure) throw meter.failure;
  return meter?.signal;
};
export function failTransientBudget(reason: WorkflowGuardError, abort = false) {
  const meter = meters.getStore();
  if (!meter) return;
  meter.failure = reason;
  if (abort) meter.stop.abort(reason);
}
export function reserveTransient(amount: Reservation) {
  const meter = meters.getStore();
  if (!meter) return;
  if (meter.failure) throw meter.failure;
  meter.signal.throwIfAborted();
  const fields = [
    ["steps", "maxSteps"],
    ["calls", "maxCalls"],
    ["inputTokens", "maxInputTokens"],
    ["outputTokens", "maxOutputTokens"],
    ["costMicros", "maxCostMicros"],
  ] as const;
  for (const [field, cap] of fields)
    if (meter[field] + (amount[field] ?? 0) > meter.budget[cap])
      throw new WorkflowGuardError("budget_exceeded");
  for (const [field] of fields) meter[field] += amount[field] ?? 0;
}
