# FE-11 native URL state and recoverable forms

## Status

Implementation is locally validated; exact-source CI and publication are pending.
The preceding verified runtime is `d63a4b1d28bcfd372e79ae6b4475867ad892a708`.
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
and the Linux golden images; no baseline or tolerance was changed. The complete
Linux CI suite remains required before publication.

The existing long-history, streaming, reader ownership and route request profiles
passed in that selection. Build-size checks use the same default build/environment
as the reviewed baseline, rather than comparing a fixture-enabled build against
it. Local default gzip measured entry 125,974 bytes, all JS 260,331 bytes, all CSS
14,317 bytes, largest JS 125,974 bytes. All four ceilings passed without exception.
All seven local harness checks, 78 architecture fixtures, both clean dependency graphs (446 structural / 445 runtime modules) and three native budget cases passed. Exact-source CI evidence is still required before release.

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
inheriting the image's Node 26. Final exact-source CI remains required.

## Rollback

Restore the previous application source. No migration or persistent format needs
reversing. Conversation records and authorization remain server-owned.
