# BE-13 durable queue observations

## Evidence and bounded plan

The [sustained result](capacity-sustained-result.md) has 5.6-second p95 time from
job creation to durable source_read, but the sampled ingestion_jobs queued age
peaks near 1.75 seconds. Those are different populations: admitted jobs can be
processing while their workflow waits. Add explicit workspace-scoped durable
queued/ready/running/lease/approval counters instead of renaming the old gauge.

Use PostgreSQL filtered aggregates over only active statuses and the lab's
owned workspace IDs. Preserve the existing job-only gauge. Queue readiness
uses available_at, including retry backoff. Ready age starts at the later of
creation/availability; expired-lease age means time past lease_until, not total
execution duration. Heartbeat only renews lease_until, so updated_at is not a
reliable heartbeat age. Missing leases are a separate category. Empty ages stay
null and confirmed empty counts remain zero. Do not infer API pool waiting.

The additive observation fields have their own queueMetricsVersion; previous
reports are immutable. No production endpoint, schema, grant, index, queue,
provider or dependency changes. Before starting the API, a disposable six-row
fixture must exercise ready/backoff, valid/expired/missing leases and approval,
check another scope is empty, and delete those exact rows in finally. Verify
cleanup before any worker starts; no fixture workflow may be dispatched.
Records contain only synthetic opaque bytes and fixed internal metadata, never
private content or credentials. Normal lab cleanup remains the final safety net.

Native receipt checks and both actual short image-based paths must pass in
fresh CI. A short fixture proves measurement semantics/delivery, not sustained
queue capacity, recovery, real-provider cost or production sizing. No old report
is backfilled and BE-13 remains partial for the remaining scenarios.

## Status

Implementation and local validation are complete: 15 native fixture cases and
driver/helper syntax checks pass. Receipt checks distinguish ready/backoff,
disjoint leases, approval, null ages/confirmed zeros and invalid scopes without
including raw state. A six-row actual SQL fixture is wired before API startup,
with scoped cleanup and a post-cleanup empty check. At least one valid runtime
queue observation is required before the lab can report success; sampled zeros
do not prove there was no activity between observations.

Fresh actual SQL/image-based pilots and all four normal CI jobs passed at
`2c2ed48e7316bc1532e6522e74400322770ee15b`. No application
runtime, hosted record/schema, provider, dependency or production endpoint changed.
Database failures may retain a validated five-character SQLSTATE classification,
never the statement, detail, stored input or provider body. This keeps a failed
fixture diagnosable without broadening report content.

## Observed CI evidence, 2026-11-08 UTC

- [Capacity run](https://github.com/willianmesko/rag-study-mvp/actions/runs/42447041760),
  job `128628070484`, artifact `13603674499`: both short paths passed.
- [Quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42447041699):
  all four jobs passed, including 95 actual PostgreSQL cases with zero skips,
  410 UX cases with 46 intentional profile skips, architecture/harness checks,
  the isolated embedding cutover and actual API/MCP image checks.
- Reviewed reports:
  [pilot](../../reports/capacity/reviewed/pilot-2c2ed48.json) and
  [durable pilot](../../reports/capacity/reviewed/durable-pilot-2c2ed48.json).
  Each is version two with `queueMetricsVersion: 1`; earlier files are unchanged.

Both pre-start SQL fixtures observed exactly two queued chats, one ready chat,
three running chats split into one valid, one expired and one missing lease,
and one evaluation awaiting approval. Ready and expired-lease ages were near one
second, rather than the records' one-hour creation age. Other-workspace reads
and post-cleanup reads returned confirmed zero counts and null ages. The API
had not started and `workDispatched` is false.

Both runs captured 14 valid runtime observations, without observation failures.
The durable pilot sampled up to two leased chats and one leased ingestion;
the legacy pilot sampled zero durable work, consistent with its disabled path.
These maxima are sampled observations, not queue-capacity or recovery guarantees.
No approval/evaluation execution or expired-lease recovery was load-tested.

The legacy pilot completed 102 search/answer pairs and six ingestion jobs. The
durable pilot completed 93 pairs plus six post-ingestion answers, with 99 completed
chat rows, six completed ingestion rows and 526 checkpoints. Both retained six
new-source checks, zero unexpected request failures, no OOM, no host ports,
three clean process exits and zero cleanup failures. Native event-loop samples
were present in both phases; API pool waiting and real provider cost remain
unknown. This short evidence does not replace the separately pinned sustained
result or complete BE-13.

This is a CI-only delivery. The live application remains at `bbc1ada` as recorded
in the [combined release receipt](release-2026-11-08-records-and-capacity.md);
another Render deployment is neither required nor claimed.
