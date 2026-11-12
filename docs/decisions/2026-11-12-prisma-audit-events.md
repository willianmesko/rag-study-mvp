# Prisma audit-event repository

Status: implemented and locally validated; fresh CI/production pending.

## Candidate selection and risks

The inventory contains 18 named repositories and five additional specialized SQL
adapters. Model policies already use Prisma in the API. Audit events are the next
bounded candidate: one append-only insert, no read-modify-write, lease, workflow
fence or multi-statement transaction. Onboarding is not equally simple: its atomic
GREATEST/OR/conditional goal update preserves concurrent device progress. Evaluation
writes require workflow fencing and partial-index idempotency. Neither is replaced
with a naive ORM upsert in this increment.

Audit is security-sensitive even though its SQL is simple. Preserve every field,
nullable actor/resource IDs, JSON behavior, database-generated UUID/timestamp,
tenant foreign key, index and RLS. An audit failure must still reject the caller;
never catch and silently drop it. Existing business mutation and audit are separate
operations: this migration does not newly make them atomic or roll back an already
completed business mutation. Callers retain their authorization and safe metadata
policy. No raw question/document or credential logging is introduced.

## Implementation

- Add a mapping of existing `audit_events` to the partial Prisma schema. Existing
  SQL migrations remain authoritative; no DDL, new grant or hosted mutation.
- Implement the existing `AuditEventRepository` port using typed `create` with
  only the generated ID selected. Preserve legacy JSON.stringify semantics before
  handing metadata to Prisma, including non-finite-number/null behavior.
- Bind `AUDIT_EVENTS` through Nest to the same `PrismaPersistence` instance already
  used by model policies. Inject the port into core runtime composition. Application
  and domain code do not import Prisma. Standalone composition keeps the legacy SQL
  implementation for compatibility/rollback.
- Do not change endpoint contracts, guards, model allowlists or audit business events.

## Performance and contention

One ORM insert must emit exactly one SQL statement. The audit adapter must add no
pool: Prisma stays at two connections per API instance. However, SQL audit writes
previously used the primary pool (max ten); they now share the two-connection
Prisma pool with model-policy reads. This may queue policy reads during bursts.
Reducing pools is not evidence of unlimited throughput or lower end-user latency.

`scripts/benchmark-prisma-audit.mts` runs only against a disposable loopback
`prisma_pilot_*` database. It compares both implementations on an equal pool, then
compares the actual before/after topology with four concurrent audit writes and a
model-policy read. Pools are warmed. Report median, p95 and max, not a single timing;
keep outliers. Query-count and connection ceilings are CI gates; noisy machine
latency is published as evidence, not a universal CI threshold. The report contains
only synthetic measurements and no credentials, SQL parameters or user content.

## Validation plan

- Real Nest DI selects the adapter; authorized policy edits and conversation
  creation persist the expected audit records.
- Owner versus viewer/non-member behavior stays unchanged; denied requests cannot
  write successful audit events.
- SQL/Prisma writes have equivalent JSON/null/Unicode values, server-generated
  defaults and tenant FK behavior. Concurrent appends cannot overwrite events or
  change workspace binding.
- A database constraint fault makes the HTTP operation fail with sanitized output.
  RLS remains enabled; a connected authenticated-role Prisma client cannot append.
- Reuse/dispose the bounded pool; compare query count, latency and mixed workload.
- Required Prisma CI runs both policy and audit integrations and exports benchmark
  measurements. Existing backend, SQL/workflow/MCP, architecture, eval, image/OCR
  and UI gates remain required before publishing.

## Reproduction

After applying the existing SQL migrations and local auth fixture to a disposable
`prisma_pilot_*` database:

```sh
PRISMA_PILOT_DATABASE_URL=postgresql://rag:rag@127.0.0.1:5438/prisma_pilot_audit \
  npm --workspace @rag-study/api run test:prisma
PRISMA_PILOT_DATABASE_URL=postgresql://rag:rag@127.0.0.1:5438/prisma_pilot_audit \
  npm --workspace @rag-study/api run bench:prisma:audit
```

The mapping adds no parallel migration history. Rollback selects the previous
compatible application image/SQL adapter; both can read the same stored events.

## Local evidence (2026-11-12)

[Raw synthetic measurements](../operations/benchmarks/prisma-audit-local-2026-11-12.json)
record 588 appended rows with no extra runtime pool, one statement per Prisma
append and at most two connections in the equal-pool comparison. Node 24 on arm64
connected to local Docker PostgreSQL 16 on x86_64; keep that emulation/host noise
in mind. No hosted database or model provider was used.

| Mixed topology, four audit writes + one policy read | Audit p95 | Policy-read p95 |
| --- | --- | --- |
| Legacy audit on primary(10), policy on Prisma(2) | 3.982 ms | 2.437 ms |
| Audit and policy sharing Prisma(2) | 4.161 ms | 5.188 ms |

The policy-read increase is about 2.75 ms in this fixture. Accept the bounded
pilot for the demo with the existing two-connection ceiling; retain a hosted
mixed-load/pool-wait check before scaling or migrating high-volume ledgers.
Do not describe this as a speedup or ignore the maximum outliers in the report.
CI publishes fresh measurements, but gates query count, pool ceiling, row count
and correctness rather than timing on variable runner hardware.

Both required Prisma integration cases pass with zero skips, including real
policy/conversation HTTP events, connected restricted-role denial, concurrent
workspace appends, audit constraint-failure behavior and disposal. The 100 existing
PostgreSQL cases and seven evaluation harness checks pass; both architecture graphs
are clean. The candidate image passed two native OCR cases and health/private-auth/404/
SIGTERM smoke with exit 0. Fresh CI and production receipts remain pending.
