import { AsyncLocalStorage } from "node:async_hooks";
export type Observation = {
  kind:
    | "workflow.stage"
    | "workflow.effect"
    | "provider.call"
    | "tool.call"
    | "http.request";
  name: string;
  correlationId?: string;
  runId?: string;
  workflowKind?: string;
};
export type OperationalEvent = {
  operation:
    | "workspace_invitation"
    | "budget_webhook"
    | "provider_request"
    | "upload"
    | "ingestion";
  outcome:
    | "retry"
    | "dead_letter"
    | "delivered"
    | "deduplicated"
    | "replayed"
    | "invalid_usage";
  reason: string;
};
export type UsageObservation = {
  provider: string;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  source: string;
  costUsd?: number;
  costSource: "reported" | "estimated" | "unknown";
};
export interface OperationalObserver {
  observe<T>(event: Observation, work: () => Promise<T>): Promise<T>;
  record?(event: OperationalEvent): void;
  usage?(event: UsageObservation): void;
}
const correlation = new AsyncLocalStorage<string>();
let observer: OperationalObserver = { observe: (_event, work) => work() };
export const setOperationalObserver = (value: OperationalObserver) => {
  observer = value;
};
export const currentCorrelationId = () => correlation.getStore();
export const withCorrelation = <T>(id: string, work: () => T) =>
  correlation.run(id, work);
export const observeOperation = <T>(
  event: Observation,
  work: () => Promise<T>,
) =>
  observer.observe(
    { ...event, correlationId: event.correlationId ?? currentCorrelationId() },
    work,
  );
export const recordOperationalEvent = (event: OperationalEvent) =>
  observer.record?.(event);
export const recordOperationalUsage = (event: UsageObservation) =>
  observer.usage?.(event);
