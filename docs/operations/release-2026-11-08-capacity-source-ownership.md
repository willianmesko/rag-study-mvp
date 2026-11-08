# BE-13 owned ingestion sources and BE-08 compiler diagnostics

## Findings and scope

The original pilot's owner maps contain only seeded IDs. A freshly indexed
legitimate source can be retrieved under mixed traffic, and must be checked in
the disposable database rather than silently accepted or mistaken for a scope
failure. A bounded query on the owned workspace/chunk IDs hydrates those maps;
checks also require that the chunk belongs to the returned document. Invalid or
foreign IDs remain rejected. Six post-ingestion searches/answers force this path
outside the measurement phases. The new report records those checks and lookup
counts. This does not change application authorization or assert model quality.

The quality harness prints only stderr on failure, but TypeScript sends its
compiler diagnostics to stdout. For the typecheck step only, print the last
8,000 stdout characters before the existing stderr tail. Do not dump provider,
evaluation or other application stdout. A temporary synthetic TS2322 fixture
proved the compiler diagnostic is visible, exit code remains one and the
harness stops before provider checks. The fixture was removed in finally; the
subsequent normal seven-check harness passed. No permanent mirror test or
new dependency was needed for this small developer-output change.

## Validation and status

Nine native guard/provider cases pass without skips, including source-pair
mismatch, unknown sources accepted only after scoped authoritative lookup and
rejection when that lookup provides no ownership. The complete local harness
passes; its optional performance gate remains unexecuted. The actual new-source
SQL path, six post-ingestion answers and cleanup must pass in fresh CI. The
normal release gates remain required. No image/load pass is claimed locally
because the Docker VM remains full. No application/runtime, dependency, schema,
cloud key or hosted setting changes are included in this increment.

Implementation and local validation complete; fresh CI/load proof pending.
