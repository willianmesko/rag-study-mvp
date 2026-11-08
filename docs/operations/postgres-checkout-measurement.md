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
model-performance gate is not executed. The actual SQL max=1 fixture and both
actual version-three image-based pilots await fresh CI; publication is pending.
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
direct paths, an instrumented sustained cohort, large-file/restart/slow-reader
and replica scenarios remain open. Keep BE-13 partial.
