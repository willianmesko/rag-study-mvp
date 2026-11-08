# BE-13 bounded sustained capacity experiment

## Evidence and next decision

The reviewed short pilots prove the harness, scoped sources, ingestion replay
and cleanup, but not sustained scale. The next bounded experiment uses ten
workspaces/50,000 synthetic chunks, ten clients and 30 minutes of mixed traffic.
One workspace owns 80% of the corpus. Keep the existing resource caps and
deterministic providers. Use a separate short durable pilot before the long run,
so expensive setup is not the first test of that execution path.

The old workspace * 10,000 chunk-ID stride collides when a workspace contains
40,000 chunks. Increase the stride within the existing synthetic UUID format,
validate profiles and record corpus version two; never compare it as identical
to version-one baselines. Vectors still do not measure semantic or multilingual
quality. Keep exact-vector reference comparisons and document/chunk ownership.

Use encrypted durable workflows with a new synthetic per-run key, local fixture
identity and fixed provider names. The sustained cohort uses the minimum allowed
60-second semantic-cache TTL, a workspace-sized key sequence and clears only its
owned fixture cache between phases. Record actual cache hits, workload/deadline
settings and omissions instead of assuming the cohort stayed cold.

The driver has fixed pilot/durable-pilot/sustained profiles, no arbitrary scales,
timeouts or provider URLs. The long experiment has a 45-minute total deadline
(including seed/setup), a 48-minute CI cap, bounded observations and stops traffic
on failures. Retain the current guarded cleanup and no external provider egress.
Normal pushes run short pilots. The sustained profile requires explicit workflow
selection or the reviewed [capacity-sustained] main-commit marker; no production
deployment or database is used for the experiment.

This public repository uses the existing standard ubuntu-latest runner.
[GitHub documents free standard-runner compute for public repositories](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
Artifact/cache storage has separate allowances; retain small bounded JSON
measurements, not container images or corpus dumps. No paid LLM or hosting
service is added. The measured run remains required before drawing conclusions.

Even a passed sustained run will not complete BE-13: pool/event-loop timing,
large PDF/DOCX/OCR bursts, restart/slow-reader cases and multi-replica limits
remain separate. Do not change the production topology based on a short pilot
or call simulated-provider timing real-model performance.

## Status

The three fixed profiles and corpus version two are implemented. All
12 portable fixture/profile cases pass, including safe failure receipts and uniqueness across the 50,000
chunk IDs. A durable profile must also show completed chat/ingestion rows and
persisted checkpoints in its owned database; enabling a flag is not execution
proof. Both short image-based paths and all four normal CI jobs now pass at
39547aa. The sustained run still needs its separately recorded result.
The workflow runs both short profiles on a normal selected push. The
[reviewed launch](capacity-sustained-run.md) selects the next bounded long run.

## First durable attempt

At `b72c52b`, the [actual lab](https://github.com/willianmesko/rag-study-mvp/actions/runs/42441083950)
passed the legacy pilot (104 completed pairs and six completed uploads). The
durable cohort completed its 91 search/answer pairs but failed ingestion_drain.
All three containers exited zero and owned cleanup passed; no sustained run was
launched. The failure report did not retain job/workflow terminal categories,
so it does not establish the underlying cause. Add fixed-category/count-only
failure receipts before retrying. Do not weaken job-completion or budget guards
to make the pilot pass, and do not call that failed cohort a durable baseline.

Source review found a concrete instrumentation mismatch: the queue-wait query
required processing/started, which only the legacy worker emits. The durable
graph starts with source_read/started. Select that actual first-work event for
the durable profile, retain the six-event/completed-job assertions and record
queueWaitStartStage so the definition is explicit. Give measurements their own
failure stage and retain safe status/stage/reason counts if a later assertion
fails. This is a harness correction; no application budget or completion rule
changes. The fresh actual durable run below confirmed the corrected outcome.

## Corrected short proof

The [fresh lab](https://github.com/willianmesko/rag-study-mvp/actions/runs/42441662257)
passed at `39547aac0c05da350e23359b44e3fa959f1f8466`. The reviewed
[legacy report](../../reports/capacity/reviewed/pilot-39547aa.json) records 104
measured search/answer pairs; the [durable report](../../reports/capacity/reviewed/durable-pilot-39547aa.json)
records 87. Each also completed six new-source search/answer checks and all six
deduplicated uploads, with all three process exits and owned cleanup successful.
The durable database has 93 completed chat rows, six completed ingestion rows,
no noncompleted runs and 502 checkpoints. Queue-wait measurements use the
explicit first-work event for each path. The earlier failed attempt remains
recorded; no product guard was weakened to get a passing result.

Both use corpus version two with 1,000 chunks and synthetic providers; neither
is the 50,000-chunk sustained baseline. Their cache samples differ and timing
includes durable replay polling. Do not infer that either path is faster from
these short cohorts. API caps remain 512 MiB/0.5 CPU, PostgreSQL 2 GiB/2 CPU and
provider 256 MiB/1 CPU. The fixture's graph guard is explicitly 30 steps, provider
deadline 10 seconds, and quotas are high but finite; these are lab settings,
not a claim about production configuration. Keys are ephemeral and never appear
in reports. All four [normal CI jobs](https://github.com/willianmesko/rag-study-mvp/actions/runs/42441662380) also passed. The sustained run still needs its own evidence.
