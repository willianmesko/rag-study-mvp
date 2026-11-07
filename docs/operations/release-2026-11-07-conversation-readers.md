# FE-06 conversation windows and execution readers

## Status

The remaining FE-06 conversation slice is implemented and locally validated
after `2fcd121`. Exact-source CI and observed deployments are still required
before calling this version live. FE-07's broader state-transition work remains
a separate ticket. No package, backend endpoint, SQL migration, provider policy,
checkpoint format, quota or model allowlist changed.

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

- Five pure window/merge/scope/budget cases and nine browser cases passed across
  desktop/tablet/mobile: 42 focused checks using synthetic fixtures and no paid
  providers. They cover 75 visited turns (150 chat messages), cursor order, old
  feedback, unpinned scroll, visibility, SSE ownership, HTTP fallback, comparison
  Stop races, disposal, offline recovery, 401/403/429 and exhausted-SSE handoff.
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
  (439 structural / 438 runtime modules); all 78 guard fixtures passed. Full CI
  and deployment results are recorded after their gates complete. Baselines and persistence/
  recovery tests are retained.

Previous verified runtime: `2fcd1215a1f6c8f8cdd10039d23814616d394db6`.
