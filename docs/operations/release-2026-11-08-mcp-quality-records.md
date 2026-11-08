# BE-12 checked MCP quality-report records

## Findings and bounded plan

The MCP quality reader casts driver rows to a TypeScript type and uses Number
on each metric. Unlike the evaluation repository's checked decoder, this can
turn a null/empty required measurement into zero or pass a non-finite result
after a stored-data/driver defect. Current PostgreSQL constraints protect normal
rows; this is a read-boundary consistency gap, not evidence of an unauthorized
writer or an isolation incident.

Reuse the existing decimal-ratio parser through the small stored-record helper.
Decode the MCP reader's allowlisted physical fields, real Date/boolean/count
types and a bounded ten-run page before mapping it. Keep nullable unknown
metrics null and measured zero as zero. Preserve the owner check, SQL scope,
read-only transaction, statement/lock deadline, cancellation and output labels.
Reject an invalid internal result limit before a checkout. No new dependency,
generic repository framework, schema or credential is needed.

Unit cases cover decimal/null/zero output, missing/corrupt fields, finite/range
and page bounds, rollback/release and unchanged scope bindings. A disposable SQL
case checks real driver numeric/Date behavior and workspace isolation without
disabling database constraints. Existing MCP read-only image/role/privacy and
evaluation-record cases remain required. Other repository families remain open.

## Status

Implementation, validation and publication are complete at
`df20190c4f90ce6d8df10126e56985a824343eaf`. Three new adapter cases plus existing owner/privacy/deadline/cancellation
and stored-record cases passed (22 focused cases, zero skips). All seven local
harness checks passed; the optional performance gate remains unexecuted. Both
architecture graphs pass (450 structural modules/1,788 edges; 449 runtime
modules/1,296 edges). The new actual-PostgreSQL decimal/null/Date/scope case is
implemented but not counted as executed locally because the Docker VM is full.

The ratio schema is shared by the existing evaluation repository and MCP's
narrow allowlisted row decoder; there is no new domain/wire DTO or duplicated
ratio implementation. Missing/empty/non-finite required measurements fail with
a fixed stored-record error. Failed pages rollback and release; invalid internal
limits acquire no connection. The fresh normal gates, image checks and capacity
pilot remain required before publication. No paid provider, credentials or
hosted SQL changes are involved.

## Published evidence

All four [quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42438247236)
passed: 410 UX cases/46 deliberate profile skips, 91 actual PostgreSQL cases
without skips, the isolated cutover, 78 architecture fixtures, seven harness
checks, four route-state cases, six artifact cases, nine native capacity cases
and three payload cases. The exact-source [capacity pilot](https://github.com/willianmesko/rag-study-mvp/actions/runs/42438247235)
also passed, including post-ingestion source verification and cleanup. The new
SQL case proved decimal/null/Date semantics and workspace isolation; it did not
remove or disable database constraints to simulate corruption.

The actual read-only API image applied 31 migrations and repeated zero; it and
the Render build independently passed both native OCR cases with zero skips.
Both reported 490 application files/1,551,015 bytes, 14 entry roots, zero project
test artifacts and the reviewed 31-file SQL digest.

Both services were observed LIVE at the exact source on 2026-11-08:

- API `dep-dbnttttg1s2s73dm6nk0`: 02:32:41.826085 UTC.
- Web `dep-dbnttup5efls73cbd50g`: 02:32:12.595509 UTC.

The public 02:37:27 UTC check verified entry/lazy/CSS assets, original icon bytes,
health/readiness, request correlation, protected routes, discovery and malformed
requests. The empty unauthenticated legacy write returned 401. The API error/fatal
window 02:32:41–02:37:54 UTC was empty. No private question, hosted SQL operation,
provider call, key or role activation was used. Other stored-data families and
the minimum-privilege activation ticket retain their own acceptance criteria.
