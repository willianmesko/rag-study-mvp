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
their unmeasured values remain null. The currently running sustained source
7c37d96 has no probe; do not backfill new measurements into its result.

Validate empty/invalid samples, fixed HTTP surface and cleanup locally, then
both actual short image-based paths in fresh CI. Their duration is enough to
prove measurement delivery; it does not replace an instrumented sustained run.
Instrumentation has overhead, which is part of the reported lab environment.
BE-13 retains sustained/instrumented, pool, large-file, restart and replica work.

## Status

Implementation and local validation are complete. All 14 native fixture cases
pass, including empty/invalid measurement handling, unit conversion, real zero,
fixed HTTP surface and sampler/server cleanup. Probe and Docker/runner syntax
checks pass. The helper opens no sampler/server when imported by the driver;
only the API preload starts one inside its owned container. The final production
Dockerfile/CMD and application runtime code are unchanged by instrumentation.

Actual short image-based proof and normal CI remain required. The active long
run and its production candidate are unchanged by this preparation. Its
version-one result must retain null event-loop measurements.
