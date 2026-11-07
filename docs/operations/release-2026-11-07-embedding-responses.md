# BE-12 bounded embedding-response decoding

## Status

Validated and published at `5e63333c1a188be34953e690c1e4214b9a9960d6`.
It hardens the three existing embedding adapters using the installed Zod and
native guards. No provider/model/dimension, index, cache version, price,
credential, migration or library version is changed. Bedrock activation remains
separate; SDK tests are mocked.

## Concrete findings and changes

Titan parsed an opaque SDK response body with a TypeScript assertion. Checking
only `.length` could accept a string/object as a vector. OpenRouter/Ollama checked
numeric arrays before enforcing the requested vector/batch size, potentially
allocating many validation issues for a large malformed response.

The shared `infrastructure/embeddings/embedding-response.ts` first checks the
trusted index dimension and exact array size, then validates only those elements
as finite numbers. It returns a typed vector or a fixed `invalid_response` error.
The two HTTP adapters require exactly one result because their requests submit
one text, and pluck unknown envelope values before item validation. Unexpected
batches and malformed records fail closed instead of selecting arbitrary results.

Titan verifies the SDK body type/byte cap before text decoding, parses to unknown
and uses the same vector decoder. HTTP adapters retain their existing streamed
body cap. The SDK already buffers its response before this check; this is a
bounded decode/validation guard, not a claim that the SDK never allocates a large
network buffer. Dimension checks precede element traversal to bound validation
work and error allocation.

Native token accounting remains independent from output quality: a valid receipt,
including zero, is published even when the vector is unusable. Missing/malformed
usage is left unknown and never fabricated as zero. Invalid bodies/parser issues
are not attached to public errors or retained as raw causes.

The Titan request remains a float embedding request with its configured dimension
and normalization. The [AWS response contract](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-titan-embed-text.html)
was checked; there is no new model invocation, SDK operation or generation-token
parameter. The SDK body is opaque to its generated TypeScript response type, so
existing Zod validation is appropriate at this application-owned JSON boundary.

## Validation and release requirements

Twelve focused checks passed: seven new embedding/shape/usage cases plus existing
provider-registry and native-usage regressions. They cover valid finite values,
zero and invalid usage, malformed JSON/envelopes, strings/objects/null/non-finite
values, unexpected batches, dimension mismatch, pre-traversal rejection and
oversized SDK bodies before decoding. Strict API typechecking passed.

All seven local harness checks passed, including strict types, unit tests,
production build, injection screening, golden retrieval, replay regression and
Promptfoo. Architecture checks found zero violations across 450 structural
modules / 1,773 edges and 449 runtime modules / 1,279 edges. Fresh CI must still
pass PostgreSQL/cutover, UX, native artifact/payload and actual MCP-image gates
before publication; those required gates subsequently passed as recorded below. The local Docker
capacity limit is already documented; it does not waive CI. No paid provider,
real AWS service, user content or notification is used in these checks.

This validates structure and numeric compatibility, not semantic relevance,
factual confidence, vector normalization quality or real-model recall. Existing
embedding/index migration requirements stay in effect. Other repository/JSON
families and old configuration fixtures keep BE-12 partial.

Rollback restores the preceding source; existing valid vectors and indexes do
not need a migration or reindex for this validation-only change.

## Publication evidence

All four [exact-source CI jobs](https://github.com/willianmesko/rag-study-mvp/actions/runs/42426024057)
passed: 410 UX cases / 46 deliberate skips, 85 PostgreSQL cases / zero skips,
the isolated cutover, 78 architecture fixtures, seven harness checks, four native
route-state, three artifact and three payload checks. The actual restricted MCP
image again passed its five-tool/network-disabled/write-rejection check.

| Service | Deployment | Observed live on 2026-11-07 UTC |
| --- | --- | --- |
| API | `dep-dbnrfbe417fc73ei0hq0` | 23:47:38.795163 |
| Web | `dep-dbnrfcm7bikc73dbchj0` | 23:44:35.774001 |

The Render API build at 23:44:22 UTC passed both actual native OCR tests with
zero skips; its clean runtime receipt counted 490 files, 1,533,403 bytes,
14 entries and zero project test artifacts. Public checks at 23:48:14 UTC
verified served assets/icon, health capabilities, server correlation IDs,
private-route rejection and OAuth input handling. The error/fatal API window
23:47:38–23:48:55 UTC was empty. A health request during the transition timed out
before the new deployment became live; the subsequent matched-source checks
passed. No private real-provider question or third-party OAuth consent is claimed.
