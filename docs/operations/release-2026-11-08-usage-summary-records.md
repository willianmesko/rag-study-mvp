# BE-12 checked usage summary projections

## Finding and bounded plan

PgUsageMetricsRepository.totals currently applies Number(value ?? 0) to every
physical aggregate field. This accepts booleans/empty text as numbers and can
emit NaN or infinite values. String(model) can fabricate a dimension, while an
invalid Date can leak a raw serializer error. SQL already returns a total row
and COALESCE zeros for a genuinely empty window. Preserve those intentional
zeros; a missing/corrupt aggregate must not become an invented measurement.

Use the existing Zod and fixed stored-record decoder for the interpreted SQL
projection, retaining PostgreSQL decimal/exponent strings and actual Dates.
Require finite nonnegative numbers and safe integer counts, one total row,
valid bucket dimensions and calendar dates. Reuse existing dimension contracts.
Keep the SQL, 1–90 day bounds, workspace predicate, one-snapshot partitions,
sorting, old-ledger semantics and reported-versus-estimated provenance intact.
Do not rewrite history, add pricing, alter record() or enable an exporter.

Native repository tests will cover driver shapes, real zero versus missing,
invalid fields/Date/dimensions, fixed diagnostics and pre-query window guards.
Existing real SQL tests already reconcile totals/partitions, native free cost,
older ledger rows, empty windows, dates and workspace boundaries. Extend those
only for missing relevant assertions. A controlled legacy-row fixture also
corrupts/restores its own estimated amount with NUMERIC NaN. PostgreSQL's
[documented numeric comparison rules](https://www.postgresql.org/docs/current/datatype-numeric.html#DATATYPE-NUMERIC-DECIMAL)
mean a nonnegative check alone does not establish finiteness. No constraint is
removed and no hosted row is inspected or edited. Fresh SQL/CI is required; local Docker
cannot substitute while its VM is full. No new dependency/schema is needed.

## Status

Implementation and local validation are complete. Four new native repository
cases plus the existing usage HTTP cases passed (six focused cases, zero skips).
All seven harness checks and both dependency graphs pass (450 structural
modules/1,794 edges, 449 runtime modules/1,302 edges). The optional performance
gate is unexecuted until a measured baseline is selected. Strict API typechecking
also includes the extended legacy/corrupt/restore SQL fixture.

The SQL and write path are unchanged. No hosting setting, key, dependency or
schema migration is required. Actual PostgreSQL/normal CI and publication are
still pending; local unit success is not reported as real SQL proof.
