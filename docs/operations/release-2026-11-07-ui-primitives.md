# FE-09 semantic actions and shared dialogs

## Status

**Frontend and API are live** at `42a0edb62cb124b47dd4d8ef6656b8b253cf36cf` after all four
[exact-source CI gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42414978269) passed. FE-09 is complete.
The [primitive guide](../frontend-primitives.md) explains the implementation.
No dependency, provider setting, schema, migration or backend contract changed.

| Service | Deployment | Observed live at UTC |
| --- | --- | --- |
| API | `dep-dbnpdf3rjlhs739g89c0` | 2026-11-07 21:23:53 |
| Frontend | `dep-dbnpdhou01pc73dco40g` | 2026-11-07 21:24:05 |

The source push skipped automatic publication. Fresh remote-head/queue checks and
all four CI successes preceded the manual triggers; both records match that SHA.

## Scope

- Semantic action tokens reference the existing Tailwind palette and preserve
  resting dimensions. Primary/secondary/danger actions share hover, active,
  focus, disabled and busy behavior. Text links receive hover styles too;
  disabled items remain inert through native/Radix semantics.
- Overlay is the only native dialog implementation. Creation, member edits and
  standalone original files join the existing compatible modal/side-panel users.
  Initial focus, pending dismissal, native-close synchronization and a stable
  fallback when an opener disappears share one lifecycle. Workspace-menu creation
  focuses its trigger before opening, avoiding a disappearing-menu-item target.
- Radix remains responsible for selection, disabled options, keyboard navigation
  and popup dismissal. ActionMenu joins SelectField in using dialog-local portals.
- Original-file lifetime is shared by inline/modal views: authenticated no-store
  fetch, explicit 30-second read deadline, abort on close/resource change, no URL
  for a late aborted response, and revocation of the owning temporary blob URL.
  Unsupported active HTML is rejected; MIME/name and new-tab safeguards remain.
- Source previews, evidence and search-result cards move from generic shared UI
  to the `entities/source` Public API. Excerpt and similarity presentation is
  reused inside that domain. Escaping, blocked previews, PT/EN decimal formats,
  distinction between cited/context passages and the meaning/accuracy warning
  are preserved. No new domain dependency enters generic shared controls.

## Verification

Local validation passed 98 focused cases across desktop/tablet/mobile, with ten
intentional profile exclusions. Eight new primitive cases and a member-removal
focus case add 25 executed checks/2 profile exclusions to the full suite. The
select/menu/Escape sequence also passed 12 repetitions across the three profiles.
Axe contrast, reduced-motion action transitions, no horizontal overflow and
focus/hover box stability are included. Original bytes and account identifiers
are synthetic. All 78 architecture fixtures passed with zero graph violations
(445 structural modules/1,747 dependencies; 444 runtime/1,257). The seven-check
local harness passed. Exact-source CI and publication passed as recorded below. New browser cases build a
fixture using the installed Vite API and the actual components/production CSS.
The fixture is test-only and never imported into the product build. Existing
screenshots/thresholds, Radix and native forms are retained.

## CI and public verification

The final CI passed **374 UX-suite cases/46 deliberate profile skips**, 83 real
PostgreSQL cases and one isolated embedding cutover with zero skips, all 78
architecture fixtures with zero violations and all seven harness checks.
Existing visual baselines and thresholds were retained.

Public checks at **21:27:41 UTC** confirmed frontend HTTP 200, entry
`/assets/index-BezoCY0O.js`, lifecycle chunk
`/assets/WorkspaceSwitcher-DDnxkCLM.js` and stylesheet
`/assets/index-CS2-Q0PU.css` with the new semantic action tokens. Prior lifecycle,
recovery and response-decoding markers remain present.

The icon initially failed a strict encoded-file hash comparison. The 256-pixel PNG
was served in a 5,721-byte encoding instead of the source's 7,628-byte encoding.
A fresh isolated Chromium comparison found **zero differing rendered channels**;
both rendered pixel hashes are
`1b60f00bd367fffbd3c72ab615db1300d90243bda17ac31803503930441d0a98`.
The proof was bound to the exact source/served encoded hashes before accepting
that variant. No product image, screenshot baseline or tolerance was changed.
The evidence establishes pixel identity, without attributing the transformation
to a specific cache/encoder implementation.

API health returned 200 with OCR, durable workflows and conversations enabled,
and server-controlled request correlation. Private conversation/MCP/alert routes
returned 401 without credentials. OAuth resource discovery/S256 and sanitized
malformed/unsupported request rejection remained intact. The API error/fatal
query for **21:23:53–21:27:55 UTC** returned no records; this is a bounded window.

No real-account conversation, private document, provider invocation, notification
or third-party consent was used. Synthetic browser and isolated database tests
cover authorized behavior; exhaustive assistive-technology and private production
interaction testing are not claimed. Previous verified runtime: `fe9449b`.
