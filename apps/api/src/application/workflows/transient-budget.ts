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
};
const meters = new AsyncLocalStorage<Meter>();
export function withTransientBudget<T>(
  budget: WorkflowBudget,
  work: () => Promise<T>,
): Promise<T> {
  if (meters.getStore()) return work();
  return meters.run(
    {
      budget,
      steps: 0,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
      signal: AbortSignal.timeout(budget.timeoutMs),
    },
    work,
  );
}
export const transientSignal = () => meters.getStore()?.signal;
export function reserveTransient(amount: Reservation) {
  const meter = meters.getStore();
  if (!meter) return;
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
