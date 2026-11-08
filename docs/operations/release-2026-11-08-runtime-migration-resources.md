# BE-14 runtime migration resources and safe CLI failures

## Concrete findings

The emitted migration entry is a supported runtime root, but resolves SQL at
`apps/api/db/migrations` relative to its emitted module. Neither API Dockerfile
copies that directory. The clean JavaScript tree/native OCR checks therefore
do not establish that the separately declared migration command can run in the
image. This blocks using the actual API image to initialize the isolated BE-13
capacity fixture. Existing hosted migrations were not rerun or changed.

The same CLI prints the complete caught error. PostgreSQL failures can include
credential or row details. It also closes the pool only after a successful
checkout, leaving a failed checkout outside its resource-cleanup block.

## Bounded implementation plan

- Copy the existing SQL catalog into both aligned API images; retain root-owned
  read-only runtime files and a clean application tree with no project tests.
- Inspect the catalog with native file/hash helpers: sorted SQL filenames,
  complete digest/byte count, no symlinks, unexpected files or missing catalog.
  Keep the compiler entry roots as their existing single source of truth.
- Preserve DDL order, tracker and per-migration transactions. Close the pool
  after checkout failure and emit a fixed migration failure with a bounded
  migration ID/SQLSTATE, never the caught object/message/cause.
- Add a real API-image CI check using a separate disposable loopback database.
  Compare the image catalog with the source, apply all migrations, rerun the
  actual CLI to prove idempotence and compare tracker versions. Keep the two
  mandatory native OCR cases and minimal MCP-image check.

Use the existing pg, Docker, compiler, Node test runner and crypto modules. No
ORM/migration framework, dependency, production schema or secret is needed.
Unit checks cover catalog absence/mutation/symlinks and a real local PostgreSQL
protocol rejection containing a synthetic private sentinel. Fresh CI supplies
actual image/SQL proof because the local Docker VM remains full. This is a
packaging/logging prerequisite for BE-13; it does not measure production capacity
or approve the separate Auth SDK upgrade.

## Status

Implementation, validation and publication are complete at
`e6fb0b095914cc30fbe898d9b3121e76b775458c`. Six native artifact cases and the real protocol-rejection
CLI case pass with zero skips. Strict types pass, and both architecture graphs
are clean (450 structural modules/1,783 edges; 449 runtime modules/1,289 edges).
All seven harness checks pass; the optional performance gate remains unexecuted.
The first harness attempt failed in its unit step; its abbreviated failure output
did not identify the case. The independent full unit run passed 383 cases with
one intentionally optional local SQL skip, and the repeated complete harness
passed. No skipped/failed run is counted as successful image or database proof.

The catalog is copied into both API images and the minimal MCP builder (the
read-only MCP final image does not ship migration SQL or a migration command).
The build and native OCR receipts include its digest and size. The new required
CI step builds the actual API image, compares its catalog, applies it to a
separate disposable fixture and repeats the CLI to check tracker/idempotence.
No actual image or PostgreSQL pass is claimed locally: the Docker VM is full.
Publication requires all four normal quality gates, that actual image check and
both matching application deployment records.

## Published image and production evidence

All four [quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42433702660)
passed: 410 UX cases/46 intentional skips, 88 actual PostgreSQL cases, one isolated
index cutover, 78 architecture fixtures, seven harness checks, four native route
cases, six artifact cases, three payload cases and the actual five-tool MCP
image. The new API-image check passed on a fresh Linux runner: 31 catalog files,
52,893 bytes, digest
`f3d3581a9a83a1568390cc0d249968dcec8016d09596a1004e043f6d711c253b`,
31 first-run migrations, zero second-run migrations and 31 tracker versions.
The container ran read-only. It reported 490 application files/1,547,606 bytes,
14 entry roots and zero project test artifacts. Both native OCR cases passed
with no skips. No local Docker/SQL result substitutes for this CI evidence.

Both services were observed LIVE at this exact source on 2026-11-08:

- API `dep-dbnsvegu01pc73dllrtg`: 01:28:15.244271 UTC.
- Web `dep-dbnsvfpsrm7s73ac06e0`: 01:27:11.758849 UTC.

The actual Render build at 01:26:55 UTC independently passed both OCR cases and
reported the same clean tree/catalog digest. The public 01:28:50 UTC check
verified entry/lazy/CSS assets, original icon bytes, health/readiness, correlation
IDs, protected routes, discovery and malformed-request behavior. No private
question, hosted database migration, real provider call or secret was involved.

The inspected API error/fatal window 01:28:15–01:29:57 UTC was empty.
