import assert from "node:assert/strict";
import test from "node:test";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  OpenTelemetryObserver,
  openHttpSpan,
  validateOtlpEndpoint,
} from "./telemetry.js";
import {
  WorkflowApprovalPending,
  WorkflowGuardError,
} from "../../platform/workflows/types.js";
import {
  withCorrelation,
  currentCorrelationId,
} from "../../platform/observability/observer.js";

test("manual workflow/tool spans retain correlation and reason codes without source text", async () => {
  const exporter = new InMemorySpanExporter();
  const sdk = new NodeSDK({
    autoDetectResources: false,
    metricReaders:[],
    serviceName: "test",
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  sdk.start();
  try {
    const logs: unknown[] = [],
      observer = new OpenTelemetryObserver((value) => logs.push(value));
    const requestId = "b52bdc78-0677-4bbf-b7bb-e51e6f764fd7";
    const http = openHttpSpan("POST", "/v1/admin/uploads/:id", requestId);
    await withCorrelation(requestId, () =>
      http.run(async () => {
        assert.equal(currentCorrelationId(), requestId);
        await observer.observe(
          {
            kind: "workflow.stage",
            name: "retrieval",
            correlationId: requestId,
            runId: "fixture-run",
            workflowKind: "chat",
          },
          async () => {
            await observer.observe(
              {
                kind: "tool.call",
                name: "list_sources",
                correlationId: requestId,
              },
              async () => ({ content: "PRIVATE_DOCUMENT_SENTINEL" }),
            );
          },
        );
        await assert.rejects(
          observer.observe(
            {
              kind: "provider.call",
              name: "embedding:private-identity",
              correlationId: requestId,
            },
            async () => {
              throw new Error("PRIVATE_PROMPT_SENTINEL api-key-SENTINEL");
            },
          ),
        );
        await assert.rejects(
          observer.observe(
            { kind: "workflow.stage", name: "approval" },
            async () => {
              throw new WorkflowApprovalPending();
            },
          ),
        );
        await assert.rejects(
          observer.observe(
            { kind: "workflow.stage", name: "limits" },
            async () => {
              throw new WorkflowGuardError("budget_exceeded");
            },
          ),
        );
        await observer.observe(
          { kind: "provider.call", name: "chat:fixture" },
          async () => ({ ok: false }),
        );
      }),
    );
    http.end(200);
    http.end(500);
    const spans = exporter.getFinishedSpans();
    const parent = spans.find((span) => span.name === "http.request")!;
    const stage = spans.find(
      (span) => span.attributes["lumora.operation"] === "retrieval",
    )!;
    assert.equal(stage.parentSpanContext?.spanId, parent.spanContext().spanId);
    assert.equal(stage.attributes["lumora.correlation_id"], requestId);
    const waiting = spans.find(
      (span) => span.attributes["lumora.operation"] === "approval",
    )!;
    assert.equal(waiting.attributes["lumora.outcome"], "waiting");
    assert.notEqual(waiting.status.code, SpanStatusCode.ERROR);
    assert.equal(
      spans.find((span) => span.attributes["lumora.operation"] === "chat")
        ?.status.code,
      SpanStatusCode.ERROR,
    );
    assert.equal(
      spans.filter((span) => span.name === "http.request").length,
      1,
    );
    assert.doesNotMatch(
      JSON.stringify({
        spans: spans.map((span) => ({
          attributes: span.attributes,
          events: span.events,
          status: span.status,
        })),
        logs,
      }),
      /PRIVATE_|api-key|private-identity/,
    );
  } finally {
    await sdk.shutdown();
  }
});
test("OTLP configuration rejects embedded credentials and insecure non-local endpoints", () => {
  for (const url of [
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com?q=secret",
    "https://example.com/#secret",
  ])
    assert.throws(() => validateOtlpEndpoint(url));
  assert.equal(
    validateOtlpEndpoint("http://otel-collector:4318/"),
    "http://otel-collector:4318",
  );
  assert.equal(
    validateOtlpEndpoint("https://example.com/otel"),
    "https://example.com/otel",
  );
});
