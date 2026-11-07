# Administrative query ownership and native TypeScript checks

## Status and scope

This increment resumes the saved FE-06 administrative-read slice and BE-08 native
TypeScript slice after `cbd0f67`. Code is implemented and locally validated;
publication still requires exact-source CI and observed deployments. Neither
FE-06 nor BE-08/FE-08 is marked fully complete.

## Behavior

- Explicit bounded resource reads use a ten-second deadline composed with the
  caller's abort signal, including response body/JSON reading. The selection is
  at each API operation; there is no blanket GET policy. Provider-backed search,
  writes, streams, originals and conversation transports retain their own rules.
- Document queries no longer have a five-second interval. Mount, focus,
  reconnect, mutations and terminal ingestion revisions refresh the library.
- One observer in the workspace control center owns the three-second job
  interval while an observed job is queued/processing. Sections share its scoped
  query. Terminal revision changes invalidate both filtered/unfiltered document
  caches and Ask readiness. Revision memory is bounded to the current job page.
- Error states stop automatic polling. A failed read never approves, uploads,
  cancels or repeats a model call. Manual retry and focus/reconnect remain reads.
- Evaluations poll only while a reference/job is active; waiting for approval
  alone has no rapid timer. An explicit approval invalidates the read and resumes
  active reconciliation. Completion stops it again.
- Demonstration-library readiness also emits a completion notification to its
  owning view. Source admission and indexed readiness occur at different times;
  neither the library nor the document list depends on a perpetual document
  interval to discover the completed import. Catalog errors stop its interval.
- Visible owner usage still refreshes every 30 seconds and stops on section
  unmount/error. Settled/empty Ask readiness reconciles every 30 seconds; active
  processing retains the three-second cadence, plus mount/focus/reconnect checks.
- API `noUnusedLocals` and `noUnusedParameters` are enabled after resolving the
  six pre-existing diagnostics. Changes remove unused imports/types or rename an
  intentional mock parameter. No API, SQL, provider, SDK or runtime logic changes.

The control-center monitor is scoped to the signed-in user and workspace. It
does not own server execution; detaching a read is separate from cancelling a
durable job. Dedicated onboarding and conversation transport work remain separate.

## Verification and measurements

`tests/ux/query-ownership.spec.ts` uses the actual query provider, synthetic API
fixtures, request counters and the browser clock. All nine new cases plus the
existing chat reentry check passed across desktop/tablet/mobile (30 cases).
They check idle state, active-to-terminal refresh, filter prefixes,
approval transitions, usage disposal, 401/403/429 and invalid JSON success shapes,
offline recovery, read disposal and the real browser deadline. The deadline case
uses active browser time; its clock is not replaced with a mock timeout.

In the controlled 18-second idle window, document and job request counts remain
one each, including the initial read. The old configured five-/three-second
intervals would schedule three/six additional requests in that window. That
comparison is calculated from the old configuration, not a field measurement or
an AI-cost saving. The terminal transition adds exactly one read for each active
filtered/unfiltered document query, then stops. Provider/write counters remain
zero in read-only scenarios; approval is sent once only after the explicit click.

Strict API typechecking passes with the new native flags. All seven local harness
checks passed, including builds, unit tests, golden set, injection, replays and
local Promptfoo with telemetry/updates disabled. Both architecture graphs have
zero violations (437 structural/436 runtime modules); all 78 guard fixtures
passed. Exact-source CI and production evidence are pending final record.

The first full CI run (`42404854787`, source `9e381a8`) passed backend, cutover and
verify gates, with 271 UX passes/44 deliberate skips and three failures in the
same demo-readiness flow across viewports. No deployment was triggered. That gate
exposed the missing completion notification previously masked by document polling.
The application was corrected; original tests and baselines were retained. The
combined discovery/query suite then passed 41 cases with four deliberate profile
skips locally, plus a fresh strict web typecheck. A fresh exact-source CI run is
required for the fix.

## Remaining acceptance criteria

- FE-06: separate durable capability from whether conversations are observed;
  remove overlapping active-run readers; refresh the latest messages without
  fetching every older page; verify a 75-message history, detachment and exactly
  one explicit cancellation without resubmission.
- BE-08/FE-08: a separate compatible promise/Hook correctness pilot and remaining
  focused chat-transition coverage. Native unused checks are not a lint suite.
- FE-07 remains the separate state-transition increment; no state-machine library
  or generic query/store framework is added here.

Previous verified runtime: `cbd0f677baff2b415b16a785ea67bcbf48c99cc2`. No schema,
checkpoint version, dependencies, secrets or feature activation changes occur.
