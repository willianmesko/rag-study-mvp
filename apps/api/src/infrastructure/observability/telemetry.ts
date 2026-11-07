import { InvitationDeliveryError } from "../../application/integrations/workspace-invitations.js";
import {
  context,
  trace,
  metrics,
  SpanStatusCode,
  type Attributes,
} from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  PeriodicExportingMetricReader,
  AggregationType,
} from "@opentelemetry/sdk-metrics";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import type {
  Observation,
  OperationalEvent,
  OperationalObserver,
  UsageObservation,
} from "../../application/observability.js";
import {
  WorkflowGuardError,
  WorkflowApprovalPending,
} from "../../application/workflows/types.js";
import { IntegrationFailure } from "../../application/integrations/retry-policy.js";

const bounded = (value: string | undefined) =>
  value && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value) ? value : "unknown";
export function failureReason(error: unknown): string {
  if (
    error instanceof WorkflowGuardError ||
    error instanceof IntegrationFailure
  )
    return error.code;
  if (
    error instanceof WorkflowApprovalPending ||
    (error instanceof Error && error.name === "GraphInterrupt")
  )
    return "approval_required";
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "deadline_exceeded";
    if (error.name === "AbortError") return "cancelled";
    if (
      ["McpReadToolForbiddenError", "McpAuthorizationError"].includes(
        error.name,
      )
    )
      return "authorization_denied";
    if (
      ["McpBudgetExceededError", "ChatBudgetExceededError"].includes(error.name)
    )
      return "budget_exceeded";
  }
  return "operation_failed";
}
export class OpenTelemetryObserver implements OperationalObserver {
  private readonly tracer = trace.getTracer("lumora", "1.0");
  private readonly meter = metrics.getMeter("lumora", "1.0");
  private readonly calls = this.meter.createCounter("lumora.operation.calls");
  private readonly duration = this.meter.createHistogram(
    "lumora.operation.duration",
    { unit: "s" },
  );
  private readonly events = this.meter.createCounter(
    "lumora.integration.events",
  );
  private readonly tokens = this.meter.createCounter("lumora.ai.tokens");
  private readonly cost = this.meter.createCounter("lumora.ai.cost", {
    unit: "USD",
  });
  private readonly unpriced = this.meter.createCounter("lumora.ai.unpriced");
  constructor(
    private readonly log: (value: Record<string, unknown>) => void = () => {},
  ) {}
  record(event: OperationalEvent) {
    this.events.add(1, {
      operation: event.operation,
      outcome: event.outcome,
      reason: bounded(event.reason),
    });
    this.log({
      event: "integration_event",
      ...event,
      reason: bounded(event.reason),
    });
  }
  usage(event: UsageObservation) {
    const labels = {
      provider: bounded(event.provider),
      model: /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/.test(event.model)
        ? event.model
        : "unknown",
      operation: bounded(event.operation),
    };
    this.tokens.add(event.inputTokens, {
      ...labels,
      direction: "input",
      source: bounded(event.source),
    });
    this.tokens.add(event.outputTokens, {
      ...labels,
      direction: "output",
      source: bounded(event.source),
    });
    if (event.costSource === "unknown") this.unpriced.add(1, labels);
    else if (event.costUsd !== undefined && Number.isFinite(event.costUsd))
      this.cost.add(event.costUsd, { ...labels, source: event.costSource });
  }
  observe<T>(event: Observation, work: () => Promise<T>): Promise<T> {
    const operation = bounded(
      event.kind === "provider.call" ? event.name.split(":")[0] : event.name,
    );
    const labels = {
      "lumora.kind": event.kind,
      "lumora.operation": operation,
      "lumora.workflow_kind": bounded(event.workflowKind),
    };
    const attributes: Attributes = {
      ...labels,
      ...(event.correlationId
        ? { "lumora.correlation_id": bounded(event.correlationId) }
        : {}),
      ...(event.runId ? { "lumora.run_id": bounded(event.runId) } : {}),
    };
    return this.tracer.startActiveSpan(
      event.kind,
      { attributes },
      async (span) => {
        const started = performance.now();
        let outcome = "completed",
          reason = "ok";
        try {
          const result = await work();
          if (
            result &&
            typeof result === "object" &&
            (("ok" in result && result.ok === false) ||
              ("isError" in result && result.isError === true))
          ) {
            outcome = "failed";
            reason = "operation_failed";
            span.setStatus({ code: SpanStatusCode.ERROR, message: reason });
          }
          return result;
        } catch (error) {
          reason = failureReason(error);
          outcome = reason === "approval_required" ? "waiting" : "failed";
          if (outcome === "failed")
            span.setStatus({ code: SpanStatusCode.ERROR, message: reason });
          throw error;
        } finally {
          const duration = (performance.now() - started) / 1000;
          span.setAttributes({
            "lumora.outcome": outcome,
            "lumora.reason": reason,
          });
          this.calls.add(1, { ...labels, outcome, reason });
          this.duration.record(duration, { ...labels, outcome });
          if (outcome !== "completed")
            this.log({
              event: "operation_finished",
              kind: event.kind,
              operation,
              outcome,
              reason,
              durationMs: Math.round(duration * 1000),
              correlationId: event.correlationId,
              runId: event.runId,
            });
          span.end();
        }
      },
    );
  }
}
let httpInstruments:
  | {
      calls: ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>;
      duration: ReturnType<
        ReturnType<typeof metrics.getMeter>["createHistogram"]
      >;
    }
  | undefined;
export function openHttpSpan(method: string, route: string, requestId: string) {
  const meter = metrics.getMeter("lumora", "1.0");
  httpInstruments ??= {
    calls: meter.createCounter("lumora.http.requests"),
    duration: meter.createHistogram("lumora.http.duration", { unit: "s" }),
  };
  const span = trace.getTracer("lumora", "1.0").startSpan("http.request", {
    attributes: {
      "http.request.method": bounded(method),
      "http.route": route,
      "lumora.correlation_id": requestId,
    },
  });
  const started = performance.now();
  let ended = false;
  return {
    run: <T>(work: () => T) =>
      context.with(trace.setSpan(context.active(), span), work),
    end: (status: number) => {
      if (ended) return;
      ended = true;
      span.setAttribute("http.response.status_code", status);
      if (status >= 500)
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "request_failed",
        });
      const labels = { method: bounded(method), route, status: String(status) };
      httpInstruments!.calls.add(1, labels);
      httpInstruments!.duration.record(
        (performance.now() - started) / 1000,
        labels,
      );
      span.end();
    },
  };
}
export function validateOtlpEndpoint(raw: string) {
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "otel-collector"].includes(url.hostname)
      ))
  )
    throw new Error(
      "OTLP requires HTTPS outside local development and credentials in headers.",
    );
  return raw.replace(/\/$/, "");
}
export function startTelemetry(options: {
  enabled: boolean;
  endpoint?: string;
  metricsEndpoint?: string;
  headers?: Record<string, string>;
}) {
  if (!options.enabled) return { shutdown: async () => {} };
  if (!options.endpoint)
    throw new Error("An OTLP endpoint is required when telemetry is enabled.");
  const root = validateOtlpEndpoint(options.endpoint);
  const sdk = new NodeSDK({
    autoDetectResources: false,
    serviceName: "lumora-api",
    views: [
      {
        instrumentName: "lumora.*.duration",
        aggregation: {
          type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
          options: {
            boundaries: [
              0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300,
              600,
            ],
          },
        },
      },
    ],
    traceExporter: new OTLPTraceExporter({
      url: `${root}/v1/traces`,
      headers: options.headers,
      timeoutMillis: 3000,
    }),
    metricReaders: options.metricsEndpoint
      ? [
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({
              url: validateOtlpEndpoint(options.metricsEndpoint),
              headers: options.headers,
              timeoutMillis: 3000,
            }),
            exportIntervalMillis: 30000,
            exportTimeoutMillis: 5000,
          }),
        ]
      : [],
  });
  sdk.start();
  return { shutdown: () => sdk.shutdown() };
}
