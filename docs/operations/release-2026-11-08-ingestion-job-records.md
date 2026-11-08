# BE-12 full ingestion-job record boundary

## Concrete finding and bounded plan

PgIngestionJobRepository.map still asserts every full-job scalar/Date field.
The schema constrains UUIDs, status and progress, but nullable chunk_count and
high_risk_chunks do not have nonnegative constraints. The same negative-count
condition exercised by the MCP fixture can reach the job API/worker projection.
Public response checks already reject incompatible shapes; an earlier fixed
stored-record error makes the repository boundary consistent and avoids raw
serializer failures. This is not a new authorization rule or a content scanner.

Extract only full-job decoding/mapping into one local infrastructure helper,
using existing shared upload status/progress/count schemas and the fixed stored
error helper. Keep driver Dates, physical UUIDs, integer progress and nullable
counts. Preserve the established zero fallback only for an absent optional
admission_attempts field; reject invalid present values. Do not add an ORM,
framework, universal repository or domain dependency on PostgreSQL/Zod.

Retain original Buffer identity and null/storage-path alternatives without
reading, parsing, logging or re-encoding file content. Listing must still omit
the payload column from SQL and supply its existing null placeholder internally.
Do not apply a full-job decoder to the indexed-original or preview projections,
which deliberately select fewer columns. Keep their existing safeguards.

Preserve all SQL, workspace predicates, upload admission locks/idempotency,
lease fences, retry/cancellation rules and transaction cleanup. Preserve the
already validated timeline decoder. Native cases must cover processing/list
scope, null/zero/legacy values, payload identity, absence and safe corruption
failures. A disposable failed/non-claimable job must corrupt/restore its own
negative count, prove reuse and be explicitly deleted before its fixture tenant.
Actual SQL/image/normal CI and exact-source publication remain required.

## Status

Implementation and local validation are complete. Four new native repository
cases and existing timeline/capability cases pass (17 focused cases, zero skips).
All seven harness checks and both dependency graphs pass (451 structural modules/
1,800 edges and 450 runtime modules/1,307 edges). The actual Buffer reference is
preserved, and the list SQL still omits payload. The optional performance gate
remains unexecuted. One new disposable failed-job SQL fixture corrupts/restores
its own high-risk count and proves read/list reuse without queueing work.

Fresh SQL/image/normal CI and publication are complete. The [combined publication](release-2026-11-08-records-and-capacity.md)
records the exact-source 95-case proof and observed live services. No hosted data,
dependency, grant, key, provider or schema change was made. The partial original
and preview projections retain their existing independent shape/guards; this
increment does not claim every stored record has been decoded.
