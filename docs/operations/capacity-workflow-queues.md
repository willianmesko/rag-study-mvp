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

Fresh actual SQL/image-based pilot and normal CI remain pending. No application
runtime, hosted record/schema, provider, dependency or production endpoint changed.
Database failures may retain a validated five-character SQLSTATE classification,
never the statement, detail, stored input or provider body. This keeps a failed
fixture diagnosable without broadening report content.
