# FE-09 semantic actions and shared dialogs

## Status

Implemented; release validation is in progress. Current live runtime remains
`fe9449b` until exact-source CI, deployment and public checks below are completed.
The [primitive guide](../frontend-primitives.md) explains the implementation.
No dependency, provider setting, schema, migration or backend contract changed.

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
local harness passed. Exact-source CI and publication remain pending. New browser cases build a
fixture using the installed Vite API and the actual components/production CSS.
The fixture is test-only and never imported into the product build. Existing
screenshots/thresholds, Radix and native forms are retained.

CI/publication receipts and bounded public verification must be recorded before
closing FE-09. Synthetic behavior tests do not claim real-account production
interaction, paid-provider calls or exhaustive assistive-technology validation.
