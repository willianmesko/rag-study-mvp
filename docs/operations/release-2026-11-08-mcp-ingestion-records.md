# BE-12 checked MCP ingestion-status projection

## Finding and bounded plan

PgMcpReadRepository.getIngestionStatus asserts six driver fields and hands an
unchecked Date/count to MCP serialization. The existing PostgreSQL status and
progress checks cover some invariants, but chunk_count is nullable INTEGER with
no nonnegative check. A negative count reaches the application result; existing
transport output schemas already reject that result before delivery. Decode it
earlier with the established fixed diagnostic and transaction rollback.
Invalid driver dates can also fail at a raw toISOString call. This is a concrete
consumer boundary, not evidence that TypeScript assertions bypass authorization.

Decode only the existing six-field projection through the established fixed
stored-record helper. Reuse shared upload status/progress/count contracts, with
physical UUIDs, integer progress and actual Dates. Preserve real zero/null counts,
null document identity and absent-job behavior. Keep the same tenant/job query,
read-only transaction, deadlines, membership/RBAC, rate/budget/audit guards and
rollback/release behavior. Do not expose file bytes, source, error text, object
paths or workflow state. No tool, grant, provider call or schema is added.

Native repository tests must exercise valid/absent and corrupt rows with safe
errors and rollback/release. A disposable failed/non-claimable job will corrupt
and restore only its own negative count, verify workspace isolation and repeat a
successful read. Fresh SQL/image/normal gates and exact-source publication remain
required. Do not change the constraint to manufacture a passing test.

## Status

Implementation and local validation are complete. Six new repository cases
plus existing MCP read/transport guards passed (18 focused cases, zero skips).
All seven harness checks and both dependency graphs pass (450 structural
modules/1,795 edges and 449 runtime modules/1,303 edges). Two disposable SQL
cases cover negative-count corrupt/restore and SQL-clamped Unicode/unknown
metadata with scope isolation. Actual PostgreSQL/CI and publication are pending;
local checks do not count as SQL proof. The optional performance gate is still
unexecuted. No dependency, schema, grant or hosted setting changed.

## Related source projection

listSources/getDocument also assert physical source/count/Date fields before
safeLabel/publicCitationUrl serialization. Add the same narrow source-row check
and a ten-row list bound. Keep SQL LEFT limits, unrecognized format/language
fallbacks, oversized-label suppression, URL/PII redaction and passage screening.
Do not equate SQL character limits with JavaScript UTF-16 lengths or reject
legitimate Unicode metadata. Existing transport output checks remain in place;
this is earlier fixed-error decoding, not a new tool permission or response.

## First real-SQL attempt

At `e3ed24a`, [normal CI](https://github.com/willianmesko/rag-study-mvp/actions/runs/42444504874)
found two fixture defects. The status fixture supplied neither payload nor a
storage path, and PostgreSQL correctly enforced
ingestion_jobs_payload_or_storage_path_check. The source fixture's assertions
ran, but cleanup tried deleting its tenant before its document, so the existing
documents_tenant_id_fkey correctly rejected deletion. Keep both constraints.
Supply synthetic terminal-job bytes and explicitly delete only that helper's
owned documents after its jobs and before its tenant. No application logic or
hosted schema is changed by this correction. Fresh exact-source CI is required;
the failed attempt is not counted as passing SQL proof.
