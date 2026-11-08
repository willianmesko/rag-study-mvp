# BE-12 partial ingestion projection boundaries

## Finding and incremental plan

The full-job decoder intentionally does not apply to `previewPassages` or
`findIndexedOriginal`: their queries select fewer fields. The preview interprets
`ingestion_jobs.chunk_count` directly, although the existing integer column has
no nonnegative constraint. A completed job with a corrupt negative count can
therefore produce an invalid preview response. Chunk IDs, ordinal and content
have physical UUID/nonnegative/nonempty constraints; the LEFT JOIN also produces
an intentional all-null passage for an indexed document without chunks.

Add small adapter-local projection decoders using the existing Zod/stored-error
convention. Validate counts and the joined/null passage alternatives, keeping
the existing three-passage query cap, unknown-security fail-closed policy,
PII redaction and clipping at their present boundaries. Do not parse or require
optional OCR/language metadata. Do not invent zero for invalid/absent counts.

The original query already pins workspace, document, source and current indexed
job, and requires stored bytes or a private storage reference. PostgreSQL gives
BYTEA as Buffer and TEXT as string. Check that driver shape without reading,
copying, interpreting or logging the bytes, or imposing a new file type/path
policy. Preserve null/private-store and legacy Buffer precedence. This is an
explicit record boundary, not a claim of a newly found authorization bypass.

No SQL, migration, grant, provider, endpoint contract, file limit, header policy
or dependency change. Existing attachment sniffing, membership, viewer/editor
permissions, audit behavior and cancellation remain separate controls.

## Acceptance

- Preserve absence, zero counts, null joined passages, private storage references
  and the exact Buffer object; do not require full-job-only fields.
- Reject malformed original driver fields, negative/nonfinite/noninteger preview
  counts and inconsistent nullable passage shapes with fixed `StoredRecordError`.
- Preserve unknown/high-risk metadata as blocked preview content, not a whole
  page validation failure. Existing HTTP evidence cases must still pass.
- Fresh disposable PostgreSQL must prove current indexed-source ownership,
  three-passage ordering/cap, empty passage joins, private/legacy originals,
  scoped negative-count corruption/repair and exact fixture cleanup.
- Pass focused cases, the complete harness, architecture checks and all fresh CI
  jobs before publication; observe both live services before marking published.

## Status

Implementation and 28 focused native/HTTP cases pass locally, including existing
viewer/original rules, redaction-before-clipping and blocked high-risk previews.
The complete seven-check harness and both architecture graphs pass locally
(452/1,804 structural modules/dependencies, 451/1,310 runtime). The optional
model-performance gate was not executed. Two actual SQL cases cover the partial
projections in the disposable PostgreSQL suite; their fresh CI execution and
publication remain pending. Local Docker execution is still unavailable because
the existing VM is full; it is not reported as a pass.
