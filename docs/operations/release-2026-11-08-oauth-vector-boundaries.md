# OAuth client and embedding vector boundary delivery

## Result and scope

Published source: `577e5007283ecafcf5372c8034849b39697515ff`. All required fresh
CI jobs and both actual short capacity paths passed. Both Render deployments
are observed live at that source and public verification passed.

The delivery combines two bounded BE-12 increments:

- [OAuth client records](oauth-client-record-boundaries.md): selected redirect
  metadata is decoded with the existing canonical callback policy, while
  preserving Unicode labels, expiry/absence and registration rollback/release.
  PKCE, exact redirects, resource binding, consent, refresh and membership
  semantics remain unchanged. No public-input authorization bypass is claimed.
- [Embedding vectors](embedding-vector-representability.md): dimension-first
  provider decoding also rejects coordinates that overflow float32 and vectors
  that become entirely zero in that format. Valid output is not normalized or
  rounded. Reported usage survives invalid output. No historical vector/cache
  rewrite, new model, reindex, provider or price change is included.

The preceding `f05105d` OAuth-only source passed all four normal gates, including
98 actual SQL cases and 410 UX cases/46 intentional skips, plus both short
capacity paths. It was intentionally not deployed separately; the final combined
source below supplies the actual publication gate.

## Final exact-source verification

[Quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42450042196):
all four jobs passed. Evidence includes 99 actual PostgreSQL cases with zero
skips, 410 UX cases with 46 intentional profile skips, isolated embedding-index
cutover, 78 architecture fixtures, both graphs, all seven harness checks, 15
native capacity, four route-state, six artifact and three payload-budget cases.
The optional model-performance gate remains unexecuted; these synthetic tests
do not activate a paid benchmark or certify answer quality.

Locally, 23 focused OAuth/native/HTTP/stdio and 16 provider/index/MCP-budget cases
passed. The before-change vector fixture accepted zero/overflow/underflow values;
the regression initially failed five of nine cases before the four-line decoder
fix. Fresh PostgreSQL now also confirms float32 conversion, zero-vector cosine
NaN and overflow rejection, with a usable connection afterwards. The OAuth SQL
case corrupts only its own synthetic client, restores it and deletes the exact
client in cleanup; it sends no email and uses no real client consent or token.

[Capacity lab](https://github.com/willianmesko/rag-study-mvp/actions/runs/42450042145),
job `128637091151`, artifact `13605017619`, passed both short paths. Reviewed
[legacy](../../reports/capacity/reviewed/pilot-577e500.json) and
[durable](../../reports/capacity/reviewed/durable-pilot-577e500.json) reports retain
their exact source and limitations. The legacy cohort has 106 search/answer
pairs; durable has 90 plus six post-ingestion answers. Each completes six unique
replayed uploads, six new-source checks and 14 valid queue observations. Durable
records show 96 completed chats, six ingestions and 520 checkpoints. Both have
zero unexpected failures, no OOM, no host ports, three clean process exits and
zero cleanup failures.

Those short reports do not replace the separately pinned
[30-minute experiment](capacity-sustained-result.md), establish semantic quality,
measure real provider billing or complete BE-13. Unmeasured values remain null.

The actual API image has 496 runtime files / 1,564,502 bytes / 14 explicit roots
and zero project test artifacts. Both required actual native OCR cases pass
without skips; the minimal MCP image passes its read-only protocol checks.
The SQL catalog remains 31 files / 52,893 bytes, SHA-256
`f3d3581a9a83a1568390cc0d249968dcec8016d09596a1004e043f6d711c253b`.
The actual read-only API image applies 31 migrations and then zero on repeat,
with 31 tracker versions in the disposable fixture. There is no hosted migration.

Local Docker is still unavailable because the existing VM is full; fresh Linux
CI provides the actual database/image evidence. No broad cleanup was attempted.
No dependency version, lockfile, service plan, role grant, exporter, email/
webhook destination or paid-provider activation changed.

## Publication

Both deployments captured the tested source and were observed live:

| Service | Deployment | Observed live, 2026-11-08 UTC |
| --- | --- | --- |
| API | dep-dbo0eqlg1s2s73dsiec0 | 05:25:52.213308 |
| Frontend | dep-dbo0es15efls73ci264g | 05:24:41.248833 |

The independent Render build records two real OCR passes/zero skips at
05:24:33.631613 UTC, matching the clean runtime/catalog receipt above.
Public checks at 05:26:30 UTC passed: main/lazy/CSS assets, source-identical
256-pixel icon bytes, API health, server-owned correlation ID, private MCP/
alerts/conversation 401s, S256/resource discovery, malformed JSON/XML rejection
and unauthenticated legacy-ingestion denial. Health reports OCR, durable workflows
and durable conversations available. These are public smoke checks; authenticated
flows use isolated CI fixtures rather than private production data or real
third-party consent.

The API error/fatal application-log window from 05:25:52 to 05:27:38 UTC was
successfully inspected and contained no entries. This bounded observation does
not certify every future request or replace authorized-flow coverage.

The prior tested/live source is `ce17d1d`. Rollback requires no schema/data rewrite.
Keep the previous original/preview receipt and pinned capacity reports as history.
BE-12 retains other action/OAuth/embedding/document sink/constraint reviews;
BE-13 retains its further capacity scenarios. The 27-ticket status table remains
21 published, five partial and one pending; small increments do not close their
remaining acceptance criteria.
