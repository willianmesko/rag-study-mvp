# FE-06 conversation windows and execution readers

## Status

**Frontend and API are live** at `c72702e198064fb9e1ea562ee3a7790c3026c843`.
The remaining FE-06 slice follows `2fcd121`. All four
[exact-source CI gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42409070907)
passed before publication. FE-06 is complete; FE-07 remains a separate ticket.
No package, backend endpoint, SQL migration, provider policy,
checkpoint format, quota or model allowlist changed.

| Service | Deployment | Observed live at UTC |
| --- | --- | --- |
| API | `dep-dbnoc5bm8hqs73cp7jeg` | 2026-11-07 20:12:48 |
| Frontend | `dep-dbnoc6jm8hqs73cp7n4g` | 2026-11-07 20:13:00 |

Both deployment records match the source above. A later documentation-only
receipt does not change the runtime source.

## Behavior

- Each API page is decoded before entering a user/workspace/conversation-scoped
  cache. The cache assembles visited turns. Refresh reads the newest 25 turns,
  merges immutable execution IDs in server sequence order, and retains loaded
  history and the oldest pagination cursor.
- After a burst, only the unseen interval is read using the existing `before`
  and `limit` parameters. After 75 visited turns, a 30-turn burst reads the head
  and five missing turns. Wrong scope, identity collisions, non-progressing
  cursors, cancellation and a 20-page refresh budget fail without committing
  partial history. The server caps conversations at 500 turns. A refresh has a
  15-second overall deadline; each metadata read has a ten-second deadline.
- Explicit older-page reads serialize against a head refresh, merge into the
  current cache and consume cancellation. They do not trigger another head
  request. Old-message feedback changes its cached record only after server
  acknowledgment, without refreshing every older page.
- Durable capability is separate from observation. Ask observes its selected
  conversation; History observes the conversation list. Search/admin do not keep
  hidden message queries running. Return/focus/reconnect revalidate the head.
  Disabling the last observer aborts a pending read, respecting another active
  observer. Selection/unmount aborts an older-page read, without cancelling work.
- SSE, saved HTTP fallback or comparison polling owns its active execution
  reader. Automatic head/status reconciliation pauses while it works or retries.
  Once SSE exhausts its bounded reconnect attempts, the recent-window reader can
  detect persisted completion without admitting another question.
- A confirmed HTTP admission is remembered for its local run. Subsequent read
  failures retry only status reads; recovery from an authorized persisted turn
  also uses GET only. If admission itself is unknown, the existing stable-ID
  idempotent retry semantics remain, rather than claiming an unverified receipt.
- An explicit Stop retains its authorized endpoint and stable run ID. Comparison
  Stop clicks coalesce. A racing status error cannot override the authoritative
  Stop response, which can report either cancellation or an already completed
  result. Navigation detaches readers rather than resubmitting/cancelling work.
- New remote messages preserve an unpinned reading position. Pinned transcripts
  continue following the latest response; the existing latest-message action
  remains available. Health, list, message and status reads consume caller signals.

These changes use React, Query, existing shared schemas and native abort control.
The product cache is cleared by the existing account-transition policy. No raw
message content is added to logs or browser storage.

## Local evidence

- Five pure window/merge/scope/budget cases and ten browser cases passed across
  desktop/tablet/mobile: 45 focused checks using synthetic fixtures and no paid
  providers. They cover 75 visited turns (150 chat messages), cursor order, old
  feedback, unpinned scroll, visibility, SSE ownership, HTTP fallback, comparison
  Stop races, disposal, offline recovery, 401/403/429, exhausted-SSE handoff and
  confirmed HTTP recovery after a transient read failure plus reload.
- With 75 turns loaded, initial reads are `head`, `before=51`, `before=26`.
  A periodic refresh makes one head read; old-page read count remains two.
  Search makes no selected-message read in a 45-second controlled window;
  History reads names rather than selected messages. A held SSE makes no
  concurrent status/head read in the tested active window. Admission stays one;
  cancellation requires a deliberate Stop.
- The old infinite-query configuration revisited three loaded pages per refresh.
  That three-call baseline is source-derived; the new counts are controlled
  browser measurements, not production latency or AI-spend benchmarks.
- The seven-check local harness passed: typecheck, unit tests, production build,
  injection suite, golden set, replay regression and local Promptfoo with
  telemetry/updates disabled. Both architecture graphs passed with zero violations
  (439 structural / 438 runtime modules); all 78 guard fixtures passed. Baselines and persistence/
  recovery tests are retained.

## CI and production evidence

The final exact-source CI passed 319 UX-suite cases (including pure window cases),
with 44 deliberate profile skips; 83 real PostgreSQL cases and one isolated
embedding cutover with no skips; all 78 architecture fixtures with zero dependency
violations; and all seven harness checks. No baseline/threshold was relaxed.

Public checks at 20:13:47 UTC confirmed frontend HTTP 200, the new
`/assets/index-B1YToNBP.js` entry, expected recovery/decoding markers and the
source-matching Lumora icon. API health returned 200 with OCR, durable workflows
and conversations active, and server-controlled request correlation. Private
conversation, MCP and budget routes returned 401 without authentication. OAuth
resource discovery and S256 remained intact; malformed JSON/unsupported token
MIME returned sanitized 400/415, and missing resource/PKCE parameters were denied.

The API error/fatal log query from 20:12:48 to 20:13:56 UTC returned no records.
These checks did not access real conversations, create grants/consent, send
notifications or invoke paid providers. Authorized conversation behavior is
covered by fixture-based UX and isolated database tests, rather than a claim of
manual production account testing.

Previous verified runtime: `2fcd1215a1f6c8f8cdd10039d23814616d394db6`.
