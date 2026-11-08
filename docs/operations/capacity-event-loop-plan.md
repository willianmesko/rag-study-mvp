# BE-13 native event-loop measurement

## Finding and choice

The capacity report explicitly leaves eventLoopDelayMs null. Docker CPU/memory
and driver latency cannot establish how much the actual API event loop stalls.
An observer in the load-generator process would measure the wrong runtime.
Use Node's existing native monitorEventLoopDelay and eventLoopUtilization APIs
inside the lab API process, following the
[Node 24 performance documentation](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html).
No monitoring package, hosted backend or production endpoint is needed.

Load a tiny native-only probe through the lab's explicit Node --import command,
from a read-only fixture mount. The unchanged application image/code remains
the test target. Only that owned internal bridge may reach the probe; publish
no host port and do not copy the probe into the production runtime. Never patch
pg, application functions, request handlers or model behavior for measurement.
It must return only allowlisted native histogram/ELU fields, no process.env,
filenames, request bodies, source content or application state.

Reset before each traffic phase, then collect bounded per-phase measurements.
Record the 20 ms sampling resolution and convert native nanoseconds to ms.
No histogram samples means null distribution fields, not zero delay. Record
utilization separately from CPU and request latency. Keep checkout wait null:
neither the observer pool nor event-loop delay measures the API's pool queue.
These are the raw native timer-based histogram values at the stated resolution,
not request latency or a manually baseline-subtracted “stall duration”. Compare
like-instrumented cohorts and do not turn the sampling interval into an SLO.

Report format version two identifies the added instrumentation and per-phase
eventLoop structure (delayMs distribution and separate utilization ratio).
Earlier version-one reports remain unchanged and
their unmeasured values remain null. At the time of this original plan, sustained
source 7c37d96 had no probe; do not backfill new measurements into its result.

Validate empty/invalid samples, fixed HTTP surface and cleanup locally, then
both actual short image-based paths in fresh CI. Their duration is enough to
prove measurement delivery; it does not replace an instrumented sustained run.
Instrumentation has overhead, which is part of the reported lab environment.
BE-13 retains pool, large-file, restart and replica work; the instrumented
sustained follow-up is now recorded separately below.

## Status

Implementation and local validation are complete. All 14 native fixture cases
pass, including empty/invalid measurement handling, unit conversion, real zero,
fixed HTTP surface and sampler/server cleanup. Probe and Docker/runner syntax
checks pass. The helper opens no sampler/server when imported by the driver;
only the API preload starts one inside its owned container. The final production
Dockerfile/CMD and application runtime code are unchanged by instrumentation.

Both actual short image-based paths and all normal jobs pass at bbc1ada.
The [durable report](../../reports/capacity/reviewed/durable-pilot-bbc1ada.json)
has 586/1,184 native samples across its phases; the
[legacy report](../../reports/capacity/reviewed/pilot-bbc1ada.json) has
567/1,183. All owned process exits/cleanup pass. See the [combined publication](release-2026-11-08-records-and-capacity.md).
The earlier sustained version-one result remains unchanged with null event-loop
measurements.

## Later sustained evidence

The separate [instrumented sustained cohort](capacity-instrumented-sustained-result.md)
passed at `75f7583`: 2,779 control and 82,518 mixed native samples. Mixed timer
histogram p95 is 21.201 ms, p99 99.811 ms, max 214.172 ms and utilization 29.16%,
at the declared 20 ms resolution. The 30-minute workload, 10,022 mixed pairs,
guarded acquisition/queue observations and limits are in that result. Both
probe windows, owned cleanup and all four fresh normal CI jobs pass. Earlier
reports remain immutable. Timer delay is not request latency or a CPU/GC diagnosis.
