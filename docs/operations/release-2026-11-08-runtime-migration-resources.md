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

Implementation and local validation are complete; fresh image/SQL CI and
publication are pending. Six native artifact cases and the real protocol-rejection
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
