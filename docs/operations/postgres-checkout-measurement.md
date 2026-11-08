# BE-13 guarded PostgreSQL checkout measurement

## Finding and bounded plan

The published capacity reports deliberately leave `poolWaitMs` unknown. Database
active-connection counts, lock waits and event-loop delay do not measure how long
the API waits to obtain a client. `acquirePostgresClient` already owns cancellable
checkout for guarded transactions/workspace locks; it is the smallest useful
measurement boundary that does not patch the driver or install a new dependency.

Use the existing OpenTelemetry API/SDK and native monotonic time. Record one
`lumora.database.checkout.duration` histogram observation (seconds) per attempted
guarded checkout, labelled only `outcome=acquired|cancelled|failed`. No SQL, DSN,
workspace/user, credential, question or received error belongs in the metric.
Telemetry failures must not change the operation. An already-aborted request
does not attempt checkout and adds no sample. A late client after cancellation
must still be released once and must not produce a successful second sample.

This measures the caller-observed duration until acquisition/failure/abort,
including queueing, connection establishment and onConnect initialization. It
excludes subsequent SQL execution and does not measure pure pool queue wait.
Direct pool.query and unguarded pool.connect paths remain outside this scope.
Keep `poolWaitMs: null`; add a separately named guarded-checkout report field.
Counts aggregate foreground/background guarded paths across application pools;
they are not HTTP request counts and do not identify a saturated individual pool.

The official [pg.Pool contract](https://node-postgres.com/apis/pool) distinguishes
new/idle/queued acquisitions and says waitingCount is queue depth, not elapsed
time. The installed OpenTelemetry 2.12.0 SDK provides public MetricReader and
explicit histogram aggregation; use those APIs rather than custom global driver
patching or a new instrumentation library.

Extend only the lab's existing private probe with an in-memory pull reader for
this exact instrument. Drop unrelated instruments, allowlist outcome labels,
bound buckets/response data and collect delta windows at phase boundaries.
No network exporter, production endpoint, schema, secret, permission, connection
limit, provider or hosting change. Existing production OTLP activation remains
separate: releasing an instrument is not proof that an exporter is enabled.

## Acceptance

- Native behavioral tests preserve client/error identity and listener cleanup,
  cancellation/late release, concurrent calls and diagnostics failure isolation.
- A disposable real SQL pool with max=1 proves actual queued contention,
  cancellation/late-client reuse, and explicit exclusion of direct pool queries.
- The lab retains fixed histogram counts/sums/min/max and bucket boundaries,
  not invented exact percentiles. Empty intervals have zero samples and unknown
  durations. Invalid collection fails the measurement instead of inventing zero.
- Both actual short image-based paths capture nonempty API-process guarded
  checkout windows. Prior versioned reports stay immutable. Report coverage and
  measurement overhead; do not infer production sizing or close all of BE-13.
- Run focused tests, full harness/architecture and fresh CI. Observe publication
  and public health/protection before marking the bounded increment published.

## Status

Implementation is locally validated: seven native behavior cases, eighteen
capacity/probe cases, the seven-check harness and both architecture graphs pass
(454/1,811 structural modules/dependencies; 453/1,316 runtime). The optional
model-performance gate is not executed. The actual SQL max=1 fixture, both
actual version-three image-based pilots and all four normal quality jobs passed
in fresh CI. Both exact-source Render deployments are live and public checks
passed on 2026-11-08 UTC. This bounded increment is published; BE-13 remains partial.
Original workspace changes are preserved. No library is added or upgraded.

## Inspection and remaining work

The version-three lab report records `guardedCheckout.phases`, with three fixed
outcomes, sample counts, millisecond sums/min/max, fixed bucket bounds and counts.
Each phase must contain acquired observations. Reset discards startup/prior-phase
delta data; overlapping collection returns a bounded busy response. Collection
errors become a fixed unavailable response, not a successful empty measurement.
The probe remains a lab-only preload on its existing private port and readonly
fixture mount. Production Docker commands and HTTP routes are unchanged.

With the existing production OTLP configuration enabled, inspect the canonical
instrument `lumora.database.checkout.duration` (seconds) and its `outcome` label.
Do not assume any particular monitoring backend's renamed series. With telemetry
disabled the API instrument is a no-op; this release does not silently enable
an exporter, create a dashboard or claim that production samples were received.

The existing SDK's pull MetricReader/histogram avoids a new library and avoids
patching pg.Pool globally. The trade-off is deliberate partial coverage and
bucketed distributions rather than exact quantiles. Pure pool waiting, remaining
direct paths, large-file/restart/slow-reader and replica scenarios remain open.
The later instrumented sustained cohort is recorded separately below. Keep BE-13 partial.

## Exact-source CI evidence

Source `151ccef257f79882754d64d6c3bf49d234ad84fc`.
[Quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42494273559)
include 410 UX cases with 46 intentional profile skips, 100 actual SQL cases
with zero skips, the isolated index cutover and 78 architecture fixtures. The
new real-pool case confirms a
queued request under max=1, a measured interval of at least 50 ms while held,
one cancellation sample, no late success, a reusable client and exclusion of
direct pool queries. Native behavior, privacy and listener cleanup cases also
pass. No hosted record or migration was changed.

[Capacity lab](https://github.com/willianmesko/rag-study-mvp/actions/runs/42494273501),
job `128773064378`, artifact `13622946989`, passed both actual image-based paths.
Reviewed [legacy](../../reports/capacity/reviewed/pilot-151ccef.json) and
[durable](../../reports/capacity/reviewed/durable-pilot-151ccef.json) reports are
version three, retain native event-loop/queue evidence and keep poolWaitMs and
actual provider cost null. All older reports remain unchanged.

| Cohort / interval | Acquired samples | Maximum observed duration (ms) |
| --- | ---: | ---: |
| Legacy / API only | 210 | 0.660169 |
| Legacy / ingestion mix | 390 | 0.181758 |
| Durable / API only | 522 | 0.163345 |
| Durable / ingestion mix | 1,138 | 0.207888 |

All observations fall in the 0–1 ms bucket in these short cohorts. This is not
an exact p95, proof of absent queueing, a sustained result or production sizing.
Cancelled/failed counts are zero in the load windows; their behavior is exercised
separately in the native/real-SQL fixtures. The durable run records 100 completed
chats, six completed ingestions and 532 checkpoints; the legacy run has 105 phase
pairs and the durable run 94. Each completes six new-source searches/answers,
six unique replayed uploads and 14 queue observations. Both stop all three
processes with exit zero, no OOM and zero cleanup failures.

The actual API image has 498 runtime files / 1,566,557 bytes / 14 roots / zero
project test artifacts. Two real OCR cases pass without skips. The SQL catalog
remains 31 files / 52,893 bytes with SHA-256
`f3d3581a9a83a1568390cc0d249968dcec8016d09596a1004e043f6d711c253b`;
the image applies 31 migrations, then zero on repeat in the disposable database.
The minimal read-only MCP image check also passes. No dependency, configuration,
pool size, schema, service plan, exporter or provider is changed.

## Later sustained evidence

The separate [instrumented sustained result](capacity-instrumented-sustained-result.md)
at `75f7583` passed with 10,022 mixed pairs, both native/checkout phase receipts
and 618 valid queue/resource observations. Guarded acquired counts are 6,552
in control and 180,504 in mixed; the mixed maximum is 87.707841 ms. The mixed
p95 falls in (0, 1] ms without revealing an exact percentile. All six unique
ingestions, terminal workflow/checkpoint checks, owned cleanup and fresh normal
CI pass. Code is unchanged from this published delivery; no redeploy or exporter
activation is required. Direct paths and pure pool queue wait remain unknown.

## Publication

All four quality jobs passed. Both observed Render deployments match the exact
tested source, on 2026-11-08 UTC:

| Service | Deploy | Observed live timestamp |
| --- | --- | --- |
| API | `dep-dbo9avjrjlhs73ap6oi0` | 15:32:11.822818 UTC |
| Frontend | `dep-dbo9b2gu01pc73ejn5s0` | 15:31:28.335671 UTC |

The independent Render build log at 15:30:54 UTC records two real OCR cases,
zero skips, the exact runtime inventory and SQL catalog digest above.
Public verification started at 15:32:29 UTC and passed:

- Frontend HTTP 200; main `index-CN4jfNbL.js`, lazy
  `WorkspaceSwitcher-BcBm5QKA.js` and CSS `index-CS2-Q0PU.css` served with the
  existing section-recovery, safe-response, chat-lifecycle and action-token markers.
- The 256×256 PNG icon is byte-identical to the reviewed source.
- API `/health` HTTP 200, with OCR, durable workflows and conversations enabled;
  the server replaces an untrusted request correlation ID.
- Unauthenticated MCP, owner alerts, conversation reads and the legacy JSON
  ingestion route return HTTP 401.
- OAuth resource/name/S256 discovery passes; malformed JSON, unsupported XML
  and missing authorization parameters fail with the expected 400/415 responses.

Real signed-in user journeys, third-party OAuth consent and production metric
delivery were not exercised. No document or provider operation was admitted.
The Render application error/fatal query for 15:32:12–15:33:45 UTC succeeded
with zero records and `hasMore: false`; this is a bounded window, not an uptime SLO.
The previous tested/live source is `577e500`. This increment can be rolled back
without a schema or data rewrite. Instrument availability is not an assertion
that hosted OTLP export has been activated.
