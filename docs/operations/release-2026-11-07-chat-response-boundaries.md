# BE-12 chat response boundaries

## Plan and acceptance criteria

The source review found `JSON.parse(...) as ...` in both OpenRouter and Ollama
stream readers. A type assertion does not validate a provider response: a numeric
or object `content` could reach `onDelta`, a malformed `done` could be silently
ignored and syntax/Zod failures could retain provider details. Non-streaming
decoding also validated message shape before publishing a valid usage receipt.

This is a bounded continuation of BE-12, not a new stream transport or provider
migration. Keep the current SSE/NDJSON framing, terminal markers, request fields,
prompt/model selection, byte/deadline/attempt guards, cancellation and callback
backpressure. Use existing Zod and native shape guards. Do not add another SDK or
parser dependency. Payload assertions become unknown values followed by runtime
decoding; malformed bodies fail with a fixed `invalid_response` error and no raw
payload/cause. Native accounting must survive malformed output when the receipt
itself is valid, including zero; malformed usage must remain unknown.

Acceptance requires normal metadata/role/usage frames, split UTF-8/CRLF frames,
terminal markers and the current optional Ollama `response` fallback to retain
behavior. Reject non-string deltas, invalid envelopes, unexpected choice batches,
malformed completion flags and malformed JSON before forwarding the affected
frame. Bound choice count before item traversal. Test cancellation/reader cleanup,
provider-error handling, incomplete streams, receipt retention and safe failures
using synthetic responses; keep existing real-loopback cancellation tests.

The official [OpenRouter streaming contract](https://openrouter.ai/docs/api_reference/streaming)
documents comments, final usage frames and `[DONE]`; both an empty-choice usage
frame and a single content-free choice must remain valid. Ollama's
[chat response](https://docs.ollama.com/api/chat) uses a boolean `done` and native
token counts. Unknown vendor metadata may be ignored without interpreting tools
or reasoning as answer text. This increment does not claim a general-purpose
SSE parser or replace later framing-library decisions.

## Status

Validated and published at `59f83e27b5aed045c1b93b5a1b5941cd0c97f566`.
Fifteen new behavioral cases and ten existing provider/transport
cases passed with zero skips. They cover split UTF-8/CRLF, role/comment/usage
frames, both accounting shapes, malformed JSON and message envelopes, invalid
deltas/flags, interrupted output, safe provider errors, callback failures and
reader cleanup. Actual loopback connections close on caller abort for both
providers. The current terminal and Ollama fallback behavior are retained.

All seven local harness checks passed. Architecture checks report zero violations
across 450 structural modules / 1,775 edges and 449 runtime modules / 1,281 edges.
The adapters decode unknown JSON, bound OpenRouter choice count before item
validation and publish only checked string deltas. Native accounting is decoded
separately, including valid zero receipts on invalid output. No raw response or
parser cause is attached to `invalid_response`. Previously delivered partial
deltas remain provisional; only the existing grounded/citation-checked workflow
can complete a product answer.

Fresh complete CI and matching live deployment receipts are recorded below. No
paid model, real user content, library version or database migration is involved.
BE-12 remains partial for other stored-record families and old shared fixtures.

## Publication

All four [exact-source CI jobs](https://github.com/willianmesko/rag-study-mvp/actions/runs/42427346385)
passed: 410 UX cases / 46 deliberate skips, 85 PostgreSQL cases / zero skips,
the isolated embedding cutover, 78 architecture fixtures, seven harness checks,
four native route-state, three artifact and three payload checks. The actual
restricted MCP image again passed its five-tool/network-disabled/write-rejection
check. This source also includes the four-family HTTP fixture migration.

| Service | Deployment | Observed live on 2026-11-08 UTC |
| --- | --- | --- |
| API | `dep-dbnrojm417fc73eilo4g` | 00:05:25.984951 |
| Web | `dep-dbnroku417fc73eils8g` | 00:04:18.017735 |

The Render build at 00:04:07 UTC passed two actual native OCR cases with zero
skips; its receipt reports 490 runtime files, 1,538,514 bytes, 14 entries and no
project test artifacts. Public checks at 00:07:59 UTC confirmed assets/icon,
semantic styles, health capabilities, server correlation IDs, private-route
rejection and bounded OAuth inputs. The API error/fatal window 00:05:25–00:08:00
UTC was empty. Real-provider questions and third-party consent were not exercised.
