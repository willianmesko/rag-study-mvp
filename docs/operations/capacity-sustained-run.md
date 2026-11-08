# BE-13 sustained synthetic run

## Instrumented follow-up, 2026-11-08 UTC

The owner requested the sustained profile again with the newly published native
event-loop, durable queue and guarded-checkout instrumentation. The application
and lab code are unchanged from `151ccef257f79882754d64d6c3bf49d234ad84fc`;
the [short-profile proof](postgres-checkout-measurement.md) passed both actual
image paths, all four normal jobs and the real max=1 SQL fixture. A fresh local
preflight passes all eighteen capacity/probe cases without skips.

This reviewed launch selects the existing fixed sustained profile using the
[capacity-sustained] marker. Retain the same corpus version two, ten workspaces,
50,000 chunks, ten clients, 60-second control, 1,800-second mixed phase, resource
caps, deterministic providers, ephemeral key and owned cleanup described below.
The process/CI deadlines remain 45/48 minutes. No benchmark threshold, application
behavior, dependency, provider, schema, hosting plan or production configuration
changes. No production deployment is required for this measurement-only commit.

Require version-three results with nonempty API-process event-loop samples and
delta guarded-checkout histograms in both phases, valid scoped workflow queue
observations, all six deduplicated ingestions/new-source checks, durable terminal
rows/checkpoints, isolation guards and successful process/resource cleanup.
Checkout includes connection/setup and aggregates guarded paths across pools;
direct queries and pure pool queue wait remain unmeasured. Preserve null actual
provider cost. Do not overwrite or backfill the first sustained report.

Retain the exact launch SHA and fresh runner/image identities. Compare the
two sustained cohorts descriptively: source changes, instrumentation overhead
and shared-runner variation preclude attributing differences to a single cause
or calling one paired before/after regression test. The run is now validated;
the [reviewed result](capacity-instrumented-sustained-result.md) records the
complete report, reproduction, comparison and remaining acceptance criteria.

Launch source: `75f758392f424c672eee9f2bf2369308ce3182bd`.
[Capacity lab 42496102159](https://github.com/willianmesko/rag-study-mvp/actions/runs/42496102159)
passed with 10,022 mixed pairs, zero unexpected failures, six completed unique
ingestions, valid native/checkout/queue evidence and successful owned cleanup.
All four fresh
[normal quality jobs](https://github.com/willianmesko/rag-study-mvp/actions/runs/42496102160)
passed: 410 UX cases/46 intentional profile skips, 100 actual PostgreSQL cases
without skips, isolated index cutover, architecture/harness checks and actual
API/MCP image verification. Both native OCR cases passed without skips; the
runtime inventory remains 498 files / 1,566,557 bytes / 14 roots / zero project
test artifacts. Both phase windows, scoped terminal rows/checkpoints and all
618 periodic observations are reviewed. The earlier report remains unchanged.

## Reviewed execution

The corrected short legacy and durable paths passed in
[Capacity lab 42441662257](https://github.com/willianmesko/rag-study-mvp/actions/runs/42441662257).
The durable fixture demonstrated 93 completed chat rows, six completed ingestion
rows and 502 checkpoints. Their source, complete reviewed reports, the first
failed instrumentation attempt and measurement limits are in the
[experiment plan](capacity-sustained-plan.md). All four [normal gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42441662380)
also passed before the reviewed launch commit.

The next marked main commit selects the fixed sustained profile: ten workspaces,
50,000 deterministic 1024-dimensional chunks, 80% in one workspace, ten bounded
clients, a 60-second control phase and 1,800 seconds of mixed traffic. Six uploads
are replayed and must produce six completed jobs. Every result must preserve
workspace, document and chunk ownership; post-ingestion sources are checked too.
Durable chat/ingestion completion and encrypted checkpoint existence are required.

Run only the existing standard ubuntu-latest runner, with the actual API image,
fresh owned PostgreSQL/pgvector and deterministic provider fixture on an internal
Docker network. API: 512 MiB/0.5 CPU; database: 2 GiB/2 CPU; provider: 256 MiB/1 CPU.
Keep the ephemeral key, fixed lab quotas/provider deadline, 60-second cache TTL,
owned cache reset between phases, explicit workload version and measured cache
hits. No application environment file, private document, hosted database or
paid provider is read. Publish no host ports or container images.

The process has a 45-minute total deadline, the CI job a 48-minute cap. A failure
stops traffic and must retain only safe categories/counts, never raw error bodies.
Cleanup is restricted to that run's labelled containers/network/volume, after
owned processes stop. Capture exit codes/OOM state and cleanup results. Retain
small JSON artifacts for 30 days; storage allowances are separate from runner
compute. No broad Docker cleanup or production deployment is part of this run.

The marker [capacity-sustained] is an explicit reviewed selection for this
documented experiment. It is not a default 30-minute test on every push. The
report's exact GITHUB_SHA, lock digest, corpus version and image IDs identify
the tested candidate. A measured report is still required; the launch document
does not certify the result.

## Interpretation and remaining work

This measures one isolated process with simulated identity/provider timings.
Do not label synthetic token usage/cost as billing, vector overlap as semantic
faithfulness, or Docker resource use as Node heap/RSS. It does not measure Render
capacity, real external provider latency, large PDF/DOCX/OCR bursts, slow readers,
worker restart/recovery, pool checkout wait, event-loop delay, or multiple replicas.
Missing measurements remain null. The model-performance release gate has its own
baseline and is not activated by this infrastructure report.

BE-13 stays partial even on success. Record observed bottlenecks before proposing
a queue, dedicated worker, shared limiter, topology or index change. No hosting,
database policy, paid service or production capacity increase is authorized by
the report itself. A failed experiment remains evidence, not a passing baseline.

## Status

The run passed at source `7c37d96e2fbf1da961bae1816b7534799517a9bb` in
[Capacity lab 42442232215](https://github.com/willianmesko/rag-study-mvp/actions/runs/42442232215).
The [reviewed result](capacity-sustained-result.md) records the 30-minute mixed
phase, 7,748 mixed pairs, six completed ingestions, observed waits, immutable
report and remaining criteria. All four original normal gates passed separately.
No unmeasured event-loop/pool/provider cost values were backfilled.

Subsequent source/MCP/job/probe changes passed their own fresh 95-case SQL,
normal gates and both short actual image-based profiles before the
[combined release](release-2026-11-08-records-and-capacity.md). The long run is
not relabelled as a measurement of that later source. BE-13 stays partial.
