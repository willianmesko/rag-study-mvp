# FE-11 native URL state and recoverable forms

## Status

**Published on frontend and API** at `2e6a4281fecb8fa55d6aa69e589d48a62999599a`, with all four
[CI gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42421393271) green. The preceding verified runtime was `d63a4b1`.
See the [state ownership guide](../frontend-url-state.md).

## Delivered behavior

- One native history listener serves application, page and conversation observers
  through React's existing external-store API. It releases ownership on the last
  unsubscribe and rejects no-op notifications. Path changes alone reset page scroll.
- Selected saved-conversation UUIDs and five document metadata filters have
  canonical codecs. Repeated/invalid values fail closed; unknown/private page
  query fields are discarded. Question/source/import drafts stay local.
- Back/Forward restores the selected conversation or filters without submitting.
  Fresh Query data may satisfy a restored filter without another HTTP read.
- Workspace switching removes a previous document/conversation selection before
  rendering the new scope; generic language/type/date filters remain available.
- A failed conversation creation retains question text and comparison mode. A
  newer draft typed during a pending create is not erased when the first starts.
  Navigation/selection guards suppress stale creation completions and errors.
- Existing filter/import form errors retain drafts and accessible associations.
  No native form is migrated to a new framework or durable draft store.

## Validation

All **21 new browser profile cases** and **four native state cases** passed locally, including bounded schema parity,
listener ownership, browser history, workspace scope, retry and draft privacy.
The broader selection passed **128 checks** with ten existing profile skips.
Three existing screenshot cases stopped on differences between native macOS Chrome
and the Linux golden images; no baseline or tolerance was changed. The subsequent complete Linux CI suite passed without a visual baseline change.

The existing long-history, streaming, reader ownership and route request profiles
passed in that selection. Build-size checks use the same default build/environment
as the reviewed baseline, rather than comparing a fixture-enabled build against
it. Local default gzip measured entry 125,974 bytes, all JS 260,331 bytes, all CSS
14,317 bytes, largest JS 125,974 bytes. All four ceilings passed without exception.
All seven local harness checks, 78 architecture fixtures, both clean dependency graphs (446 structural / 445 runtime modules) and three native budget cases passed. The final combined CI/publication evidence is recorded below.

No API, database schema, secret, provider policy, library or screenshot baseline
changed. The checks use synthetic sessions/data and invoke no paid model or real
notification. Production smoke checks do not substitute for a signed-in user's
private end-to-end session.

## Test-environment correction

Two initial CI attempts stopped before browser collection on ESM/CommonJS loader
interop in a pure codec test. The local macOS and cached Linux pilots had not
reproduced the clean-checkout loader path. These failures did not publish code.
The four environment-independent codec/store/parity cases now run with Node 24's
native test runner and type stripping, outside Playwright's transform. The seven
browser journeys still run on all three profiles. No assertion or visual baseline
was removed. The UX job explicitly selects the supported Node 24 rather than
inheriting the image's Node 26. The subsequent full Linux suite passed 407 checks and identified one old
route-policy fixture (repeated on three profiles) that used `conversation=fixture`
as though it were a valid saved UUID. That test now explicitly preserves a real
UUID, rejects the invalid placeholder and strips private query fields. The
application's pre-existing saved-conversation schema already required UUIDs.
The final complete CI passed; see the exact-source receipt below.

## Exact-source CI and production

Frontend and API are **live at `2e6a4281fecb8fa55d6aa69e589d48a62999599a`**, after all four
[release gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42421393271) passed. The source skipped automatic publication; fresh
remote-head/queue checks preceded the manual triggers. Both records match the
same source.

| Service | Deployment | Observed live at UTC |
| --- | --- | --- |
| API | `dep-dbnqjkm417fc73efp330` | 2026-11-07 22:46:39 |
| Frontend | `dep-dbnqjlqjnfac73d3sem0` | 2026-11-07 22:45:28 |

CI passed **410 UX-suite checks / 46 intentional profile skips**, **85 PostgreSQL
checks / zero skips**, the isolated cutover / zero skips, all 78 architecture
fixtures, the seven-check harness, four native route-state cases and three
frontend-budget cases. Both production dependency graphs remained clean. Build
and browser measurement artifacts uploaded successfully.

The CI default build measured gzip entry 125,974 bytes, all JavaScript 260,331,
CSS 14,317 and largest chunk 125,974, with no budget failure or exception. These
are payload measurements, not field LCP or a claimed provider speedup.

Public checks at **22:48:00 UTC** confirmed frontend 200, entry
`/assets/index-B-Qgg-J_.js`, application chunk
`/assets/WorkspaceSwitcher-OP4Wzwjj.js`, semantic stylesheet
`/assets/index-CS2-Q0PU.css` and the unchanged original 256-pixel icon bytes.
API health returned 200 with OCR/durable workflows/conversations enabled and a
server-owned correlation ID. Private MCP, conversations and administrative alerts
returned 401. OAuth resource/S256 discovery and sanitized malformed JSON 400,
unsupported XML 415 and missing-parameter rejection remained intact.

The API error/fatal query for **22:46:39–22:48:23 UTC** returned no records. This
is a bounded inspection. These public checks did not access real private user
data, invoke a paid provider, send email or complete third-party consent.
Authorized flows are covered by synthetic browser and isolated database suites.

## Rollback

Restore the previous application source. No migration or persistent format needs
reversing. Conversation records and authorization remain server-owned.
