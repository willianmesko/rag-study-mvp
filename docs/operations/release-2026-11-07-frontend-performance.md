# FE-10 reproducible frontend performance evidence

## Status

**Frontend and API are live** at `d63a4b1d28bcfd372e79ae6b4475867ad892a708` after all four
[exact-source CI gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42417537601) passed. FE-10's measurement
track is complete. No dependency, backend contract, database schema or provider
policy changed. See the [performance guide](../frontend-performance.md).

| Service | Deployment | Observed live at UTC |
| --- | --- | --- |
| API | `dep-dbnpt4ou01pc73ddr7mg` | 2026-11-07 21:58:36 |
| Frontend | `dep-dbnpt8k9v7es73dee6m0` | 2026-11-07 21:57:36 |

The source push skipped automatic publication. Fresh remote-head/queue checks
and all four CI successes preceded manual triggers; both records match that SHA.

## Delivered measurement track

- Native JS/CSS raw/gzip inspection records environment, per-asset sizes and
  source/worktree identity. A reviewed versioned baseline and four payload
  ceilings fail regressions. Explicit exceptions record reason/reviewer/deadline
  and reject invalid, duplicate, unknown or expired entries; none are active.
- Route budgets record operation counts without URLs, questions or identifiers.
  Sign-in, Ask, Knowledge and Team are profiled on three viewport/locale profiles.
  The private fixture has 20 document summaries. Script/image body sizes,
  navigation milestones and DOM size are diagnostic measurements.
- A 75-turn history loads three pages, receives 80 synthetic SSE delivery events
  paced at 20 ms, and retains 76 ordered turns. Unpinned reading and return to
  pinned scroll are checked. Frame intervals, long-task support/observations and
  fixture delivery times are recorded without imposing host-sensitive time gates.
- Build and browser JSON artifacts are uploaded per commit by CI. Local run output
  is ignored while reviewed baselines remain versioned. The reusable durable
  fixture was extracted without changing its protocol or authentication assertions.

## Measured bounded optimization

The first workload on the prior application code observed five message-window
requests: initial head, two older pages, an admission-time head read and final
reconciliation. That assertion failure identified a read starting against the
preceding render's enabled observer before reader ownership disabled it.

`startSaved` now refreshes names without invalidating messages at admission.
Completion still refreshes the message window. The same workload observes **four**
message reads, one admission and zero competing status/resume reads. This is one
fewer browser request, without claiming provider savings or a wall-clock speedup.
Existing cancel/reconnect/creation races, stable IDs, old feedback and history
cursors remain covered.

## Local validation

- 90 focused checks passed across desktop/tablet/mobile: the new 15 workload
  profiles and all 75 selected FE-06/FE-07 lifecycle/window checks. No skips.
- Three native budget tests passed: actual reproducible compression/entry
  inspection, fail-closed regressions/invalid metrics, and reviewed expiring
  exceptions. The seven-check evaluation harness also passed.
- Both architecture graphs passed without violations: 445 structural modules /
  1,747 edges; 444 runtime / 1,257. Existing architecture fixtures remain CI gates.
- Saved local browser runs explicitly identify an uncommitted tooling candidate;
  final CI artifacts must bind the exact committed source before publication.
- Byte baselines use gzip 9 and default local build configuration. Route/network
  timing uses mocked APIs, no CPU/network throttling and no real provider. Real
  field LCP, device responsiveness and production cost are not claimed. No
  screenshot baseline/threshold was changed and no optimizer library was added.

## CI and publication evidence

The final CI passed **389 UX-suite cases/46 intentional profile skips**, 83
PostgreSQL cases and one isolated cutover with zero skips, all 78 architecture
fixtures, both clean graphs and the seven-check harness. The three native budget
cases and the actual payload gate passed. Both build/browser artifact uploads
completed; the build report binds the exact source and reports a clean worktree.

CI used Linux x64, Node 24.22.2, Vite 6.4.5 and gzip 9. It measured entry 125,116
bytes, all JS 259,357 bytes, all CSS 14,317 bytes and largest JS chunk 125,116
bytes. All four ceilings passed without an exception. These small differences
from the macOS baseline are recorded, not hidden or described as a speedup.

Public checks at **21:59:50 UTC** returned frontend 200 with entry
`/assets/index-DtRr1j_c.js`, application chunk
`/assets/WorkspaceSwitcher-BwzRHLRA.js` and semantic stylesheet
`/assets/index-CS2-Q0PU.css`. The original 256-pixel icon matched the source bytes
in this check. Lifecycle/recovery/response-decoding markers remain present.

API health returned 200 with OCR, durable workflows and conversations enabled;
request correlation remains server-controlled. Private conversation/MCP/alert
routes returned 401 without credentials. OAuth resource discovery/S256 and
sanitized invalid request rejection remained intact. The API error/fatal query
for **21:58:36–22:00:15 UTC** returned no records; this is a bounded inspection.

These checks did not access a real private conversation/document, invoke a paid
provider, send a notification or complete third-party consent. Authorized behavior
is covered by synthetic UX and isolated database tests. Field/RUM measurement
and larger rendering/route optimizations retain separate evidence requirements.
Previous verified runtime: `42a0edb`.
