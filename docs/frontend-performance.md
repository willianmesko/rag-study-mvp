# Frontend performance baselines and regression budgets

## What this measures

FE-10 establishes reproducible build and synthetic browser baselines. It does not
claim field LCP, real-device responsiveness or production-provider speed. No
virtualization, memoization library, profiler service or analytics SDK is added.

- `scripts/frontend-performance.mjs` uses native filesystem/zlib APIs to inspect
  actual entry/lazy JS and CSS. It records raw/gzip bytes per asset, environment,
  source identity and local dirty-tree status. Gzip level is fixed at 9; this can
  differ from Vite's printed default compression number.
- `config/frontend-performance-budget.json` holds the measured baseline and
  reviewed growth policy. `reports/frontend-performance/baseline.v1.json` stores
  the initial local build evidence. Its source is a docs-only descendant of the
  published FE-09, with the same application code.
- `frontend-performance.spec.ts` measures fresh sign-in, chat, document and team
  routes, plus a 75-turn transcript and 80 paced delivery events. It attaches
  per-profile JSON with Node/OS/browser/viewport and normalized operation counts.
  The saved local candidate evidence is `browser-baseline.v1.json` under the same
  reports directory. It explicitly identifies the local worktree candidate.
- The browser suite reuses the durable conversation fixture. It does not call
  live Supabase, LLMs, rerankers, email delivery or production workspaces. Mock
  routing affects caching, so these are controlled fresh-page/load profiles,
  not a measurement of production HTTP-cache efficiency.

## Initial build and limits

Measurements were collected with Node 24.12.0 on macOS arm64, using the locked
Vite version and a default local build without provider credentials. CI records
its own Linux environment. Total JavaScript is the sum of individual chunks;
that total is not the amount downloaded on every route.

| Metric | Baseline bytes (gzip 9) | Default ceiling |
| --- | ---: | ---: |
| Entry JavaScript | 125,108 | 131,363 |
| All JavaScript | 259,336 | 272,302 |
| All CSS | 14,317 | 16,365 |
| Largest JavaScript chunk | 125,108 | 131,363 |

The initial build has 20 JS chunks and two stylesheets. Chunk count and hashed
filenames are reported rather than gated: an intentional split can add a chunk
without increasing initial payload. The growth ceiling is the larger of 5% or
2,048 bytes above baseline, avoiding disproportionate noise for small stylesheets.
No historical estimate is presented as a fresh measurement.

## Route and long-history profiles

These normalized API counts agree across the three local profiles. API request
ceilings are versioned alongside byte budgets; a changed endpoint set needs an
explicit review of the fixture and policy, rather than silently updating a snapshot.

| Fresh route | API/health operations | JS requests observed locally |
| --- | ---: | ---: |
| Sign in | 0 | 1 |
| Ask | 6 | 3 |
| Knowledge | 5 | 8 |
| Team | 5 | 8 |

Private fixtures expose 20 synthetic document summaries. The report also records
DOM elements, image/script body bytes and navigation milestones. These timings
are diagnostic observations on the host running the fixture. They are not release
gates on a shared CI runner and do not establish a faster real customer journey.

The history workload loads 25 turns, then two earlier pages to retain 75 turns.
A single question receives 80 delivery events paced at 20 milliseconds. These are
SSE chunks, not a count of model tokens. The workload checks unpinned reading,
return to latest, pinned scroll, one admission, no concurrent status/resume reader,
and the final ordered 76-turn transcript. It records frame intervals, long tasks
when supported, first injected chunk and delivery duration. Unsupported long-task
measurement is explicitly distinguished from an observed empty result.

### Evidence-led optimization

The first controlled run made **five** message-window requests: three history
reads, an admission-time read and a final reconciliation. The admission read
started against the previous render's enabled observer before execution ownership
suppressed/cancelled it. `startSaved` now invalidates conversation names without
starting a competing message read; terminal completion still refreshes messages.

The same workload now makes **four** message-window requests: three to load the
visited history and one after completion. The request gate preserves that count.
This is one fewer browser request in the tested workload. No corresponding
provider-spend or wall-clock improvement is claimed. Existing cancellation,
reconnection, stable IDs, old feedback and backscroll tests remain release gates.

## Reproduce and inspect

```bash
npm ci
npm run build:web
npm run test:frontend-budget
npm run check:frontend-budget -- --report reports/frontend-performance/runs/local-build.json
npx playwright test tests/ux/frontend-performance.spec.ts
```

The report contains measurements and pass/fail ceilings. Missing output, unsafe
entry paths, symlinks, malformed/non-finite metrics and expired exceptions fail
closed. Script inputs are trusted build artifacts/configuration, not user data.

GitHub Actions runs the native budget tests and gate after the existing build
harness. It uploads `lumora-frontend-build-<sha>` and
`lumora-frontend-browser-<sha>` artifacts in addition to the full UX report.
Per-run JSON is ignored locally; reviewed baselines remain versioned. No raw
questions, document text, tokens or actual user/workspace identifiers are recorded
by this measurement layer.

## Reviewing regressions and exceptions

A failed byte or request budget is a reason to inspect the changed dependency,
route ownership or asset graph. Neither script rewrites its baseline automatically.
Intentional growth requires a reviewed config change. A byte-budget exception must
record a unique ID, substantial reason, reviewer, explicit known ceilings and an
unexpired UTC deadline. Invalid/duplicate/expired entries fail; current exceptions
are empty. A reviewer string is a record of review, not a substitute for the
repository's review process or an authorization mechanism.

Existing visual baselines, keyboard/contrast and safety gates remain unchanged.
Further route splitting, token batching or virtualization needs its own before/
after evidence and accessibility checks. Field/RUM data requires a separate
operational decision and enough representative traffic; it is not fabricated
from this short synthetic benchmark.
