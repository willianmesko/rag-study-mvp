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

Exact source: `db8d236b4007fb29e0d387cb6574be3371f764c6`.
All four [quality jobs](https://github.com/willianmesko/rag-study-mvp/actions/runs/42517044431)
pass: 410 UX cases/46 intentional profile skips, 100 actual SQL cases without
skips, isolated cutover, 78 architecture fixtures, seven harness checks and the
actual API/MCP image checks. Both [short capacity profiles](https://github.com/willianmesko/rag-study-mvp/actions/runs/42517044552)
pass at the same source. These are distinct from the earlier sustained cohort.

The actual image passes two native OCR cases with zero skips, retains 498 runtime
files / 1,571,006 bytes / 14 roots / zero project test artifacts, and retains the
31-file / 52,893-byte SQL catalog with SHA-256
`f3d3581a9a83a1568390cc0d249968dcec8016d09596a1004e043f6d711c253b`.
The disposable image fixture applies all migrations then zero on repeat.

API deploy `dep-dbod8lbm8hqs7388a7m0` matches the exact tested source and was
observed live at **17:00:24 America/Sao_Paulo (20:00:24.597846 UTC), 2026-11-08**.
The independent Render build log at 19:58:54 UTC confirms two real OCR passes
without skips and the exact runtime/SQL inventory above. The unchanged frontend
remains at `151ccef`, deploy `dep-dbo9b2gu01pc73ejn5s0`; it needed no redeployment.
No schema, provider, secret, plan or telemetry flag changed.

Public verification started at 20:01:07 UTC and passed: frontend HTTP 200 with
the existing main/lazy/CSS action/lifecycle markers and 256×256 PNG icon; API
health 200 with OCR/durable capabilities and a server-owned correlation ID;
unauthenticated MCP, owner alerts, conversations and legacy ingestion all 401;
OAuth resource/name/S256 discovery and expected malformed-request 400/415.
The error/fatal application-log query for 20:00:25–20:01:10 UTC succeeded with
zero records and no additional page. This is a bounded window, not an uptime SLO.

The correction is validated and published. Public checks invoked no model or
document operation. Actual LangSmith receipt, signed-in real-provider chat and
third-party consent were not exercised; this is not a claim of hosted activation.
Rollback needs no schema/data rewrite. Historical benchmark reports stay pinned.

The previously reviewed tracing configuration is unchanged by this rollout.
Next confirm account region/destination, supply its key through the existing
secret mechanism and deliberately activate LangSmith. Verify a controlled safe
trace in the intended receiver before claiming it active, including stream
completion, cancellation and sanitized failure coverage. No destination or
credential is invented. Historical load reports retain their pinned sources.
