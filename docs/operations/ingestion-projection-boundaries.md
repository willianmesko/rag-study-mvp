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
model-performance gate was not executed. All four fresh CI jobs and both actual
image-based pilots also passed. Both services are published and public checks
passed, as recorded below.
Local Docker execution is still unavailable because the existing VM is full;
fresh Linux CI supplies the actual SQL/image proof.

## Exact-source CI evidence

Source: `ce17d1d51623d4145764f01f0d8e762bd7d66224`.

- [Quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42448152261):
  all four jobs passed. PostgreSQL ran 97 cases with zero skips, including the
  new preview/original fixtures. UX ran 410 cases with 46 intentional profile
  skips. Both architecture graphs, 78 architecture fixtures, all seven harness
  checks, the isolated cutover, 15 native capacity, four route-state, six artifact
  and three payload-budget cases passed.
- [Capacity lab](https://github.com/willianmesko/rag-study-mvp/actions/runs/42448152335),
  job `128631394275`, artifact `13604622163`: the legacy pilot completed 102
  search/answer pairs; the durable pilot completed 90 plus six post-ingestion
  answers. Each completed six unique replayed uploads and six new-source checks.
  The durable receipt has 96 completed chats, six ingestions and 512 checkpoints.
  Both have 14 valid scoped queue observations, no unexpected failures, no OOM,
  three clean process exits and zero cleanup failures.
- Actual API image: 494 runtime files / 1,562,301 bytes / 14 roots / zero project
  test artifacts. Two required native OCR cases pass without skips. The minimal
  MCP image also passes its read-only protocol checks.
- Packaged SQL: 31 files / 52,893 bytes, SHA-256
  `f3d3581a9a83a1568390cc0d249968dcec8016d09596a1004e043f6d711c253b`.
  The actual read-only API image applied 31 migrations, then zero on repeat,
  leaving 31 tracker versions in the disposable database. No hosted migration
  or schema change is part of this release.

These short synthetic pilots prove the bounded integration path, not production
capacity, semantic answer quality, real-provider costs or expired-lease recovery.
The separately pinned sustained report remains unchanged and BE-13 stays partial.

## Publication

Both Render deployments captured the exact tested source and were observed live:

| Service | Deployment | Observed live, 2026-11-08 UTC |
| --- | --- | --- |
| API | dep-dbo0146417fc73etj4og | 04:56:07.659463 |
| Frontend | dep-dbo015m417fc73etja2g | 04:55:28.515896 |

The Render build independently records two actual OCR passes/zero skips at
04:55:27.203906 UTC, with the same clean runtime/catalog receipt above.
Public checks at 04:56:34 UTC passed: main/lazy/CSS assets, source-identical
256-pixel icon bytes, API health, server-owned correlation ID, private MCP/
alerts/conversation 401s, S256/resource discovery, malformed JSON/XML rejection
and denial of unauthenticated legacy ingestion. Health reports OCR, durable
workflows and durable conversations available.

The inspected 04:56:07–04:57:53 UTC API error/fatal application-log window
contains no entries. This successful bounded read is not a claim about every
future request or a substitute for the isolated authorized-flow tests.

Authenticated originals/previews are exercised with synthetic authorized CI
fixtures, not real users' documents. Real OAuth consent, optional exporters,
provider activation and paid benchmarks retain their separate status. No actual
email/webhook, paid LLM, production upload or hosted migration was used.

The previous tested/live application source is `bbc1ada`; no schema rewrite is
needed to roll back this read-only change. BE-12 remains partial for the other
families in the boundary inventory. This release does not finish those reviews.
