# Safe LangSmith tracing for streamed answers

## Problem and bounded correction

The [inventory](observability-review-2026-11-08.md) found that answerStream and
its answer fallback bypassed the LangSmith decorator. AnswerQuestionUseCase
prefers that method even for non-SSE callers. Both methods now share one guarded
execution using the existing SDK: one optional safe root summary, one business
invocation and a disabled tracing context around the actual work.

The SDK's ROOT context prevents an enabled ambient RunTree from overriding a
child's false flag or propagating private metadata. The ambient-context test
caught that behavior. Nested graph/provider payloads remain suppressed.
No public answer/event contract, model, schema, quota, dependency, environment
variable or hosted exporter changes. Activation remains a separate step.

## Data and behavior

- Root: rag-question-workflow; mode: answer or answer_stream.
- Inputs: question character count and valid optional topK only.
- Outputs: fixed outcome, source count and refusal boolean. Actual answers,
  passages, source identifiers, filenames, vectors and event payloads never
  enter the traced arguments or return value.
- Metadata: valid UUID correlation/run IDs from the server or durable context;
  no workspace/user ID or untrusted arbitrary correlation string.
- Errors: fixed workflow_failed, cancelled or deadline_exceeded. The original
  thrown value/message/cause/stack stays outside the trace and is returned to
  the caller with its identity intact.

The business outcome is captured in the suppressed context. Only its safe
summary reaches the outer trace; the actual result/error is returned/rethrown
outside. A memoized operation prevents diagnostics failure from replaying model
work/events. Callback order, awaited backpressure and AbortSignal propagation
are preserved. Existing SDK transport/batching behavior is retained; local
testing is not proof of external receipt or a tracing latency objective.

Disabled configuration and conversation history suppress traces even within an
enabled ambient context. Previous questions retain their existing no-trace
policy. Cache hits skip this workflow root but remain in the usage ledger.
This is a safe workflow summary, not a full per-node LangSmith trace tree.

## Local validation

Eleven focused cases use the real installed SDK, an injected in-memory Client
and a network guard that fails any external request. All pass without skips:

- Stream input/signal/callback identity, ordered events and backpressure.
- Direct answer and stream fallback, with one invocation/root.
- Error/cause privacy, callback rejection and no replay.
- Mid-stream cancellation, pre-aborted work and deadline codes.
- Disabled/history suppression and ambient/nested privacy in both modes.
- Independent root metadata and concurrent correlation/failure isolation.
- Trace create/update outages preserving business results/errors.
- Real AnswerQuestionUseCase stream selection and usage recording.

The seven-check harness passes, including Promptfoo, injection, golden set and
replay gates; the optional model-performance gate is not executed. Architecture
passes with 455 modules / 1,814 dependencies structurally and 453 / 1,318 at
runtime. The focused file is included in the normal API test command.
No dependency is installed or upgraded. The original uncommitted workspace is
preserved; implementation uses the synchronized clean checkout.

## CI, rollout and activation

Fresh exact-source CI, actual image/SQL proof and observed publication remain
pending. Publish after all required jobs pass, observe the returned Render
deploy IDs become live and verify public health/protection. A push or accepted
deployment request is not publication. This change needs no database migration.

Keep the previously reviewed tracing configuration unchanged for this rollout.
Next confirm account region/destination, supply its key through the existing
secret mechanism and deliberately activate LangSmith. Verify a controlled safe
trace in the intended receiver before claiming it active, including stream
completion, cancellation and sanitized failure coverage. No destination or
credential is invented. Historical load reports retain their pinned sources.
