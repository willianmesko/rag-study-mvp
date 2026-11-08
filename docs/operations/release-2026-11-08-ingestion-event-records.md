# BE-12 checked ingestion timeline records

## Finding and bounded plan

PgIngestionJobRepository.listEvents asserts EventRow types and returns details
JSON directly. The database enforces JSONB/not-null but permits an array or scalar
instead of the object expected by the product. A corrupt driver date also reaches
toISOString in the serializer. Decode this interpreted event row through the
existing stored-record helper, reusing the shared status/stage/details contract.
Keep real driver Dates and integer/nullable durations distinct from wire strings.

Preserve unknown nested detail values, zero versus absent timing, event order,
workspace/job predicates and the 100-event HTTP limit. Do not decode/rewrite file
payloads, change processing state, filter away legitimate event metadata or add
a new storage framework. Invalid pages must fail with fixed server diagnostics,
without stored details or a raw parser cause. This is a stored-read safeguard,
not a prompt-injection classifier or new authorization policy.

Unit cases cover metadata, zero/null durations, invalid JSON/date/enum/identity
shapes and absence. A disposable SQL fixture must use a failed/non-claimable job,
check another workspace returns no events, corrupt/restore only its own details,
and prove read reuse. No hosted migration, real document or provider is needed.
Existing processing/cancel/retry, real-SQL and independent-widget gates remain.

## Status

Implementation, actual CI and publication are complete. Three new timeline-row cases plus existing process lifecycle and
narrow-capability cases passed (14 focused cases, zero skips). All seven local
harness checks pass; the optional performance gate remains unexecuted. Both
dependency graphs pass (450 structural modules/1,791 edges and 449 runtime
modules/1,299 edges).

The schema reuses shared stage/status/details contracts, retains real driver
Dates and integer/nullable stored durations, and preserves nested metadata and
ordering. It does not change worker admission, job payloads or job states. The
new disposable SQL test uses a failed, non-claimable job and corrupts/restores
only its own JSON event. Actual SQL ran on fresh CI; local Docker remains full.
No dependency, schema, key or hosted setting changes were needed.

## First fresh-CI attempt

At 25068ca the normal verify, UX and cutover jobs and the actual capacity pilot
passed. The PostgreSQL job failed in fixture cleanup: the generic helper deleted
its tenant while the new terminal ingestion job still referenced it. PostgreSQL
correctly enforced ingestion_jobs_tenant_id_fkey. Fix cleanup with an explicit
job delete scoped only to that fixture tenant, before its tenant delete; keep the
constraint and failed/non-claimable job. No broad cleanup or production change
is justified. The failed run is not counted as a passing SQL/image gate. Fresh
exact-source gates remain required before publication.

## Validated source and publication

Source `17d8aa7f208afb40ee60cc87f08141f4d6a9489f` passed all four
[normal gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42440266107):
410 UX cases/46 intentional profile skips, 92 actual PostgreSQL cases with zero
skips, the isolated embedding cutover, 78 architecture fixtures, both dependency
graphs and all seven harness checks. The actual image applied all 31 packaged
SQL files, then zero on repeat; no project tests entered the final runtime.
The separate [capacity pilot](https://github.com/willianmesko/rag-study-mvp/actions/runs/42440265845)
completed 36 API-only and 70 mixed search/answer pairs, six deduplicated completed
uploads and six new-source search/answer checks. Source guards and all three
process exits passed; owned cleanup had zero failures. This is a short synthetic
pilot, not sustained capacity or real-provider performance.

Render captured the exact tested source for both services. API
`dep-dbnuaurrjlhs739tab2g` became live at 03:01:03.980353 UTC; web
`dep-dbnub1dg1s2s73dn6l2g` at 03:00:05.149209 UTC on 2026-11-08. The Render build
independently passed both native OCR cases with zero skips at 02:59:44.873529 UTC.
Its runtime receipt has 490 files/1,552,138 bytes, 14 explicit entries, zero test
artifacts and 31 SQL files/52,893 bytes, catalog SHA-256
`f3d3581a9a83a1568390cc0d249968dcec8016d09596a1004e043f6d711c253b`.

Public checks at 03:01:27 UTC passed: frontend entry/lazy CSS/state markers,
source-identical icon bytes, health, server correlation, private-route 401s,
S256/resource discovery, malformed input handling and unauthenticated legacy
ingestion denial before work. No real document, question, OAuth consent, paid
provider or hosted migration was exercised. Log retrieval initially returned a
Loki 503. The bounded retry succeeded for 03:01:03–03:01:33 UTC with no error/fatal
application entries. That short inspected window does not establish ongoing
absence of failures.

Rollback is the prior tested `df20190` source. No schema migration or data rewrite
is needed for this read-boundary change. BE-12 remains partial for other stored
projections; this slice does not establish complete database-record coverage.
