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

Implementation and local validation are complete; fresh SQL/CI/publication are
pending. Three new adapter cases plus existing owner/privacy/deadline/cancellation
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
