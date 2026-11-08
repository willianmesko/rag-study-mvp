# BE-13 first sustained synthetic result

## Execution and reproducibility

[Capacity lab 42442232215](https://github.com/willianmesko/rag-study-mvp/actions/runs/42442232215)
passed at source `7c37d96e2fbf1da961bae1816b7534799517a9bb`. The
[complete reviewed report](../../reports/capacity/reviewed/sustained-7c37d96.json)
retains the source/lock digest, actual image IDs, resource caps, corpus version,
query plans, per-workspace timings, observations, guards and cleanup. The
[normal CI run](https://github.com/willianmesko/rag-study-mvp/actions/runs/42442232284)
also passed all four jobs separately. This source's measurements are not silently
attributed to later commits.

The process ran from 03:20:53.990 to 03:57:34.388 UTC on 2026-11-08. Seeding took
313,457 ms. Ten workspaces held 50,000 deterministic 1024-dimensional vectors;
the heavy workspace held 40,000, with the remainder split across nine spaces.
There were 20 synthetic accounts per workspace and ten concurrent clients. The
actual API image used encrypted durable workflows with an ephemeral fixture key.
No production database, real documents or paid model endpoint was used.

The owned internal Docker network published no host ports. Caps were API
512 MiB/0.5 CPU, PostgreSQL 2 GiB/2 CPU and deterministic provider 256 MiB/1 CPU.
The API/provider roots were read-only. See the report for exact images and the
[launch record](capacity-sustained-run.md) for admission/deadline/cleanup rules.

## Observed workload

| Measurement | API-only control | Mixed phase |
| --- | --- | --- |
| Duration | 60 seconds | 1,800 seconds |
| Completed search/answer pairs | 226 | 7,748 |
| Unexpected failures | 0 | 0 |
| Search p95 | 300.087 ms | 337.523 ms |
| First SSE event p95 | 127.449 ms | 43.489 ms |
| Validated completion p95 | 3,525.536 ms | 3,065.374 ms |
| Semantic cache hits | 0 | 0 |

Six uploads were replayed once each, created six unique jobs and completed.
Queue wait to durable source_read/started had p95 5,600.741 ms. After the phases,
six searches and six answers specifically verified the newly ingested sources.
There were 7,980 completed chat workflow rows (including those six later answers),
six completed ingestion rows and 47,892 persisted checkpoints. No noncompleted
workflow rows remained at the receipt check.

Every returned source/citation was checked for workspace ownership and correct
chunk/document association. Viewer upload and cross-workspace access were
denied. All three owned processes exited zero without OOM; container/network/
volume cleanup reported zero failures. These are executed functional guards,
not a claim that all possible isolation attacks were exhaustively tested.

All 30 fixture reference comparisons had full overlap at five against the exact
tenant-filtered vector baseline. This is synthetic hybrid/exact overlap. It is
not general ANN recall, language accuracy, faithfulness or factual certainty.
The deterministic vectors and deliberately simple shared facts cannot establish
real RAG quality.

## Fairness and operational clues

All ten workspaces made progress. During mixed traffic, the heavy workspace
completed 643 pairs with search p95 537.934 ms; the other spaces completed
782–799 pairs each, with search p95 100.176–340.419 ms. The distribution shows a
size-related cost in this workload. It does not prove fair scheduling under a
tenant flood: this scenario assigns one client to each workspace, not unlimited
clients to the heavy one. No multi-replica limiter was exercised.

All 617 periodic observations succeeded; 62 sampled at least one lock waiter.
That is evidence of observed waits, not their duration or exact cause. The
maximum sampled active database queries was six; this is neither total pool
connections nor checkout wait. API and PostgreSQL sampled CPU reached 51.64%
and 198.09% respectively, near their allotted half-core/two-core caps. Peaks
alone do not identify sustained throttling or the sole bottleneck.

The sampled ingestion_jobs queued count peaked at one, with maximum sampled
queued age 1,752.187 ms. That query excludes jobs already marked processing but
waiting for a durable runner. It measures a different interval/population from
the 5.6-second queue-to-first-work percentile. Add durable queued/lease-age
measurements rather than interpreting the smaller number as total queue wait.

The later mixed percentile is lower than the short control's completion
percentile. Do not say ingestion improved latency: database/process warmup,
bounded scheduling, replay polling and unequal sample sizes remain confounders.
Cache TTL was 60 seconds, with owned cache resets between phases and zero
observed hits. These results do not provide a separate warm-cache capacity test.

## Decision and remaining acceptance criteria

Keep the current topology for the demonstration. No new queue, worker service,
database index or hosting plan is justified by this single run. Investigate
per-stage query/lock and pool behavior before selecting a scaling change. The
current synthetic timings are numerically within the starting UX targets, but
those targets include a real-provider run; this does not certify production
SLOs, Supabase/Render capacity, real Auth latency or external model performance.

BE-13 remains partial. In this version-one report pool wait, event-loop delay
and actual provider billing are null. The later lab-only native probe has its
own short-run evidence and cannot backfill this report. Remaining scenarios
include an instrumented sustained run, pool/lease waiting, larger PDF/DOCX/OCR
bursts, reindex/evaluation bursts, slow readers/cancellation, crash/restart,
multi-replica burst limiting and separately budgeted real-provider measurements.
Growth/stress tiers and a model-performance release baseline remain separate.

The report's passed flag means this bounded workload completed with its declared
guards and cleanup. It does not complete every scalability acceptance criterion
or activate the optional model-performance gate.

## Later instrumented cohort

The separate [version-three follow-up](capacity-instrumented-sustained-result.md)
at `75f7583` has now passed with native event-loop, scoped workflow-queue and
guarded-checkout observations. It records 10,022 mixed pairs, six completed
unique ingestions and zero unexpected failures. Its process, comparison,
reproduction and partial coverage are documented separately. This first report,
its exact source and null measurements remain unchanged; the instrumented
sustained scenario is no longer pending, but BE-13's other scenarios remain open.
