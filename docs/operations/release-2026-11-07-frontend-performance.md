# FE-10 reproducible frontend performance evidence

## Status

Implemented and locally validated; exact-source CI/publication remain pending.
The currently live application is FE-09 at `42a0edb`. No dependency, backend
contract, database schema or provider policy changed. See the
[performance guide](../frontend-performance.md).

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

Pending exact-source results, deployment IDs and public verification. Complete
this section before closing the FE-10 measurement ticket. Field/RUM measurement
and any larger rendering/route optimization retain separate evidence requirements.
