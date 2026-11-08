# Technical architecture backlog

Reviewed on **2026-11-07**, against source commit
`e25572d6118efbdb84190367a039526775fbd0b2`.

The backend and frontend reviews were performed in parallel. The analysis is
complete and implementation is proceeding incrementally. Phase 1 retained the
existing stack without a dependency or database migration. Phase 2 includes the
explicitly approved development-only `dependency-cruiser@18.7.2`; it adds no
application framework or database migration. Product work and
live activation remain in the [product backlog](backlog.md).

## Implementation status

| Status | Tickets | Count |
| --- | --- | --- |
| Implemented, CI passed and published | BE-01–BE-07, BE-10, BE-11, BE-15, BE-16, FE-01–FE-07, FE-09–FE-11 | 21 |
| Partially implemented; remaining acceptance criteria below | BE-08, BE-12, BE-13, BE-14, FE-08 | 5 |
| Pending implementation or final validation/publication | BE-09 | 1 |

The latest batch is live on frontend and API at `151ccef257f79882754d64d6c3bf49d234ad84fc`
after all four [CI jobs](https://github.com/willianmesko/rag-study-mvp/actions/runs/42494273559) passed.
FE-11 and the bounded BE-12 configuration/record increment remain included.
BE-14's clean runtime/native-OCR portion is now published; the SDK update is open.
CI passed 410 UX cases/46 deliberate skips, 100 PostgreSQL cases, the isolated
cutover, 78 architecture fixtures, seven harness checks, four native route-state,
six artifact and three payload cases. The Render build independently passed
both actual OCR cases with zero skips and zero project test artifacts in the
final application tree. The [guarded-checkout receipt](operations/postgres-checkout-measurement.md)
records the current delivery and both short version-three capacity reports.
The earlier [OAuth/vector receipt](operations/release-2026-11-08-oauth-vector-boundaries.md)
retains its pinned evidence. The [partial-projection receipt](operations/ingestion-projection-boundaries.md)
retains its original/preview evidence; the
[combined receipt](operations/release-2026-11-08-records-and-capacity.md) retains its pinned read-boundary and separate capacity evidence. Both live SHAs, public assets, health, protected routes
and a bounded error-log window were verified.

The later measurement-only [instrumented sustained result](operations/capacity-instrumented-sustained-result.md)
passed at `75f7583` with all four fresh normal CI jobs. Application/lab code is
unchanged from the published source; no redeployment was needed. BE-13 stays partial.

See the [artifact receipt](operations/release-2026-11-07-runtime-artifacts.md),
[FE-11 receipt](operations/release-2026-11-07-url-state.md) and
[BE-12 receipt](operations/release-2026-11-07-configuration-records.md).
Instance-scoped provider deadlines, lazy compatibility configuration and the
actual minimal MCP image gate are also validated and published. See the
[deadline receipt](operations/release-2026-11-07-provider-deadlines.md) and
[image proof](operations/mcp-image-verification.md). The
[embedding-response increment](operations/release-2026-11-07-embedding-responses.md)
is now published. Native compiler checks are also
[published](operations/release-2026-11-07-native-quality.md). Automatic continuation
has published [chat response boundaries](operations/release-2026-11-07-chat-response-boundaries.md)
and all configuration fixtures. Workspace model-policy/guide record decoding
is also [published](operations/release-2026-11-08-workspace-stored-records.md).
Conversation record/recovery validation is also
[published](operations/release-2026-11-08-conversation-record-boundaries.md).
Judge/reranker response validation is also
[published](operations/release-2026-11-08-provider-assessment-boundaries.md).
BE-12 remains partial; BE-08/FE-08 retain promise/Hook work and BE-09 retains
minimum-privilege activation. Earlier releases retain their dated evidence.
The prior administrative/unused-check slice is recorded in the
[query-ownership evidence](operations/release-2026-11-07-query-ownership.md).
The prior `cbd0f67` batch is recorded in the
[capability-boundary evidence](operations/release-2026-11-07-capability-boundaries.md).
The preceding module-organization release at `d045949` is recorded in the
[phase 2 evidence](operations/release-2026-11-07-architecture-phase2.md).
The earlier six-ticket batch at `a590360` remains documented in the
[phase 1 record](operations/release-2026-11-07-architecture-phase1.md).
A checked slice below does not close the remaining portions of a partial ticket.
Phase 2/3 checks cover SQL limits, success decoding, bounded Auth/member
lookup, application composition, conservative reranking and shutdown. The full
pre-migration API suite passed 308 tests with one intentionally optional database
skip; frontend response/session/navigation checks passed 105 profile cases. This
module-organization source is published; its CI passed 81 PostgreSQL cases, the isolated cutover,
61 architecture fixtures, the harness and 247 UX cases with 44 intentional profile
skips. BE-15 is a separate, now published follow-up: its CI passed 83 PostgreSQL
cases, the isolated cutover, 78 architecture fixtures and 247 UX cases with 44
deliberate profile skips, plus the seven-check harness. Both exact-source
deployments, public health/protected routes and the inspected error-log window
were verified on 2026-11-07. General continuation remains saved in
[the resume checkpoint](backlog-resume.md).

The owner requested NestJS-style business-module organization. BE-07 includes
the [module migration](decisions/0002-business-modules.md): `modules`, `platform`
and `app`, with native Fastify factories/controllers and no NestJS dependency.
The 274-file mechanical move and ten module factories are implemented. Global
composition is 270 lines; public exports and cross-application/module/platform
checks pass with zero violations and 61 passing fixtures. The final local harness,
81 PostgreSQL tests, isolated cutover and two native container OCR checks passed.
See the [current directory guide](backend-modules.md) and
[candidate evidence](operations/release-2026-11-07-architecture-phase2.md).
The guided learning walkthrough is separately planned in the product backlog;
writing its 18-chapter plan does not complete the teaching sessions.

The original review defined 25 tickets. The subsequent concrete production-configuration finding adds BE-16, making 27 tickets including BE-15. The owner's subsequent request adds
BE-15: technology-neutral feature factories. It is a separate follow-up to the
published module organization, not a claim that grouping directories made all
integrations replaceable.

Phase 1 verification includes real PostgreSQL regressions for all four encrypted
stores under concurrent relocation/rewrite and process loss; repair after 25h
without a new provider call; real idle-client termination/replacement; native
JSON/multipart/rate-limit handling and a real Fetch-to-Fastify role PATCH. The
new cutover CI job uses a dedicated disposable database and fails when its
required fixture is missing. Browser tests cover account transitions, cache
cleanup, JSON role changes and isolated section recovery. No paid provider, real
mail, secret rotation or webhook activation is part of routine verification.

The same batch also fixes OAuth extension-parameter interoperability and exposes
Lumora’s existing brand as standard MCP server icon metadata. The exact reported
ChatGPT authorization request and a real completed client consent remain separate
validation; the PKCE/resource/client/redirect/workspace protections are retained.

Each ticket's problem, code evidence, proposed pattern/tool, reasoning and
trade-offs are documented in the [backend review](backend-architecture-review.md)
or [frontend review](frontend-architecture-review.md). This file is the execution
index: priority, affected scope, effort/risk and objective completion conditions.
Check an item only after its implementation and verification evidence are saved.

## Priorities and constraints

- **P1:** concrete behavior/reliability corrections or a prerequisite before
  activating a sensitive operational feature. This is delivery priority, not a
  vulnerability severity score. Activation gates are labeled explicitly.
- **P2:** structural consistency, reliability, maintainability or measured
  operating cost. Complete targeted corrections before broad moves.
- **P3:** improve a particular product flow after its foundations are stable.
- **Effort:** S = roughly 0.5–1.5 engineering days, M = 2–3, L = 4–6, including
  focused verification. These are planning bands, not dates or summed promises.
- **Risk:** change risk, considering state/security/contract impact. Large
  tickets must be split into reviewable changes with their own evidence.

Keep React, TypeScript, Tailwind, TanStack Query, Zod, Radix, Fastify,
PostgreSQL/pgvector, Supabase and the current LangGraph/provider adapters.
Prefer native composition, typed ports and existing test runners. Tool pilots
are explicit tasks; no library installation/migration is approved merely by
appearing in a comparison. Preserve English code/docs and automatic PT/EN UI.

Unless a full path is shown, backend paths start at `apps/api/src/` and frontend
paths at `apps/web/src/`. Line references in the detailed reviews refer to the
audited source commit and may move after implementation. Original scope paths
below identify reviewed responsibilities; the module guide maps their current
feature-owned locations during BE-07's migration.

## Phase 1 — Correct boundaries and protect operational activation

### BE-01 — Stable encryption-key inventory

- [x] **P1 · M · High risk · Activation gate: reader-key retirement.** Replace
  mutable physical-row pagination with immutable logical-key inventory or a
  rigorously quiesced protocol. Scope:
  `infrastructure/postgres/rotate-workflow-keys.ts`, the four encrypted stores,
  rotation integration tests and the [runbook](operations/workflow-key-rotation.md).
- **Accept:** concurrent heartbeat/status updates cannot hide old-key rows;
  interrupted batches resume safely; inventory authenticates all four stores;
  retirement is denied until a fresh complete inventory reports no old-key
  records. Verify decryption after retirement and retained-backup restore needs.
- **Preserve:** bounded transactions, compare-and-update, fencing, ciphertext
  authentication and no plaintext/key logging. Existing happy-path tests do not
  establish traversal safety under concurrent row relocation.

### FE-02a + BE-02 — JSON transport and safe HTTP error corrections

- [x] **P1 · S–M first slice · Medium risk.** Fix JSON headers on body-bearing
  void requests and retain safe error codes. Map trusted framework parser/body
  errors to 400/413/415/429 and unique-slug conflicts to 409. Scope:
  `shared/api/rag-api.ts`, `interfaces/http/app.ts`, error mapping and member-role
  integration tests. FE-02a is part of FE-02, not a 26th independent ticket.
- **Accept:** a real browser Fetch request reaches a real Fastify parser and an
  authorized owner changes a role. Malformed JSON, unsupported MIME and excessive
  bodies receive the documented 4xx; an unexpected database failure remains a
  sanitized 5xx. JSON/void/SSE quota and permission errors preserve reason codes.
- **Preserve:** public routes and valid payloads; never reflect arbitrary upstream
  status codes, raw bodies, SQL details or credentials. Mocked route success
  alone is not sufficient evidence for the parser/header correction.

### BE-03 — Database pool faults and workload deadlines

- [x] **P1 idle-pool listener implemented · S · Medium risk.** Scope:
  `infrastructure/postgres/pool.ts`, a fixed reason-code counter/log, and unit/
  actual PostgreSQL disconnect/replacement tests.
- [x] **P2 SQL limits implemented, CI verified and published · M.** Inventory actual connection/role
  defaults and apply workload-specific query/statement/lock limits and cleanup.
- **Accept:** an idle-client disconnect emits a safe fixed reason and does not
  terminate the service; a replacement connection works. Retrieval sleep/lock
  tests, caller cancellation and failed-transaction reuse prove cleanup and
  workload-specific limits. Inventory actual role/DSN defaults before changing
  them; do not impose retrieval deadlines on migrations/index construction.
- **Evidence:** native session/local profiles preserve stricter effective settings;
  real PostgreSQL tests cover statement/lock/idle limits, rollback, aborted checkout,
  cancelled retrieval/MCP admission and clean replacement. Pool defaults use
  30s/3s/30s; retrieval 2s/500ms/2s; maintenance 10m/10s/60s. Final CI passed.

### FE-01 — Credential-free cache identity and auth transitions

- [x] **P1 · M · High risk.** Scope: `pages/rag-lab`,
  `app/providers/QueryProvider.tsx`, workspace query factories,
  `widgets/workspace-control-center/model/queries.ts` and saved conversations.
- **Accept:** no sentinel bearer token appears in query keys; same-user token
  refresh reuses data; manual/cross-tab logout and account changes cancel/remove
  old private queries consistently. Delayed old-user/workspace results cannot
  repaint the new scope. Keep explicit identity isolation and keyed scope resets.
- **Preserve:** navigation may detach a stream without cancelling its durable
  server run. There is no claim of a demonstrated cross-user disclosure.

### FE-03 — Local recovery boundaries and safe diagnostics

- [x] **P1 · S–M · Medium risk.** Scope: `app/ErrorBoundary.tsx`, workspace lazy
  sections, chat/onboarding composition and a minimal diagnostic adapter.
- **Accept:** injected lazy-load/render failures leave navigation and another
  section usable, expose an accessible recovery action and recover without retry
  loops. A manual reload handles browsers that cache a failed module import. Recorded diagnostics exclude sentinel prompts, sources and credentials.
  Retain a root fallback for genuinely global failures; no monitoring vendor is
  installed as part of this correction.

### BE-04 — Complete budget-alert repair window

- [x] **P1 · M · Medium risk · Activation gate: unattended budget webhook.**
  Scope: ledger recording in `bootstrap.ts`,
  `infrastructure/observability/budget-alerts.ts` and outbox recovery tests.
- **Accept:** a crash after ledger commit/before enqueue, followed by 25 hours
  offline and no further provider calls, still discovers the threshold in the
  full 30-day window. Concurrent/paginated repair creates one stable delivery
  identity. Prefer atomic intent/watermark; a bounded full-window discovery is
  a smaller first fix. Preserve receiver deduplication and at-least-once semantics.

### BE-05 — Execute embedding-index cutover tests in CI

- [x] **P1 · S–M · Medium risk · Activation gate: live embedding migration.**
  Scope: `.github/workflows/quality-gates.yml`, existing
  `pg-workspace-embedding-index.integration.test.ts` and its database fixture.
- **Accept:** CI creates a separately named disposable cutover database, loads
  Auth fixtures/migrations and runs `npm run test:embedding:index` without skips.
  Rebuild, dimensions, tenant isolation, concurrent ingestion, cache invalidation,
  activation and rollback are verified. Keep destructive fixtures unable to use
  a shared/live database.

## Phase 2 — Establish durable module and contract boundaries

### BE-06 — Bounded authentication and scoped member lookup

- [x] **P2 · M · High risk · CI verified and published.** Scope: workspace/member authorization in
  `interfaces/http/app.ts`, new small Auth ports and existing Supabase adapters.
- **Accept:** one verified request principal, bounded SDK transport and separate
  public/admin clients; membership-ID-first directory lookup works for a project
  with more than 1,000 Auth users without listing unrelated accounts. Revoked
  membership still blocks access. Validate signing/cache/revocation semantics
  before substituting `getClaims` for `getUser`; the installed SDK has both.
- **Evidence:** separate stateless SDK clients, one request-scoped verified
  principal, 10s-capped transport, ID-scoped lookups with bounded concurrency/body
  size and safe transient errors. Focused tests include directory IDs beyond the
  old 1,000-account listing and concurrent cancellation isolation.

### BE-07 — Cohesive Fastify route plugins and composition

- [x] **P2 · L, split by capability · High risk · CI verified and published.** Scope:
  `interfaces/http/app.ts`, `bootstrap.ts`, route modules and typed factories.
- **Accept:** HTTP plugins receive narrow typed dependencies; vendor calls stay
  in adapters; application policies use ports; composition owns resources once.
  Existing API/RBAC/idempotency tests retain behavior without assertion-heavy
  partial dependency objects. Preserve atomic fenced transactions. No IoC,
  generic repository framework or framework migration is required.
- [x] Extract capability controllers and identity/provider/usage/ingestion
  factories; preserve parser/RBAC/idempotency behavior in typed plugin tests.
- [x] Finish feature-owned `*.module.ts` composition, named exports and automatic
  backend module checks under ADR 0002; validate the complete moved source and
  operational paths before publishing. Global HTTP composition remains in `app`.
- **Evidence:** ten explicit feature factories, narrow public capability/port
  APIs, 270-line root composition and typed module-assembly cases. Fresh policy
  resolution, receipt/fingerprint identity, independent MCP action flags and
  single workflow/resource ownership are verified; assembly performs no eager IO.

### FE-04 — Application-owned routes, session and workspace orchestration

- [x] **P2 · L, incremental · High risk · CI verified and published.** Scope: `app/App.tsx`,
  `pages/rag-lab/ui/RagLabPage.tsx`, shell composition and native route adapter.
- **Accept:** pages no longer import other pages; `app` owns routing/auth/workspace
  composition. Sign-in, invitation, incomplete onboarding, MCP consent, browser
  history and different roles in two workspaces preserve URLs and behavior.
  Retain one session subscription; no new router/global store is assumed.
- **Evidence:** application-owned native route policy, one guarded session
  subscription and lazy page APIs replace page-to-page orchestration. The focused
  three-profile browser suite covers back/forward, auth/cache and malformed data.

### BE-12 + FE-02b — Shared wire contracts and decoded boundaries

- [ ] **P2 backend, P1 frontend boundary completion · M/L by domain · Medium risk.**
  Scope: `packages/contracts`, backend schemas/serializers/config/row mapping,
  `shared/api/rag-api.ts` and domain API modules. FE-02b completes FE-02.
- **Accept:** each migrated JSON resource family has one shared Zod schema;
  invalid success data is rejected before cache insertion; error envelopes agree
  across JSON/void/upload/SSE. Typed module config and SQL row handling remove
  unsafe assumptions without equating domain models with wire DTOs.
- **Preserve:** bounded SSE/blob behavior, rollout-compatible optional fields,
  headers and provider-call counts. Any later OpenAPI generation derives from
  the same contract instead of introducing a second handwritten source.
- [x] FE-02b: shared schemas decode every migrated successful JSON response before
  cache insertion; fixed invalid-response diagnostics retain no received payload.
  Typechecking and malformed-data browser cases pass locally.
- [x] BE-12 bounded increment, CI verified and published: pure environment parsing, explicit root/HTTP configuration, independent-instance tests, checked evaluation and semantic-cache records. Nine unit cases, 85 PostgreSQL checks, the isolated cutover and seven harness checks passed. See the [boundary guide](backend-configuration-and-records.md) and [release record](operations/release-2026-11-07-configuration-records.md).
- [x] Provider-deadline/lazy-config increment is CI verified and published: immutable per-instance native clients, all eleven adapter paths and explicit HTTP import isolation. See the [release record](operations/release-2026-11-07-provider-deadlines.md).
- [x] Embedding-response increment is CI verified and published. Titan/Ollama/OpenRouter use dimension-first finite-vector decoding, bounded single-result envelopes and honest usage receipts. See the [release record](operations/release-2026-11-07-embedding-responses.md).
- [x] Chat-response increment is CI verified and published. OpenRouter/Ollama validate JSON/stream envelopes and deltas, retain native usage on invalid output and preserve real connection cancellation. See the [release record](operations/release-2026-11-07-chat-response-boundaries.md).
- [x] Four HTTP fixture families use independently parsed configuration and explicit production policy; 25 focused checks, the full harness and exact-source CI passed. Published with the chat-response increment. See the [release record](operations/release-2026-11-07-isolated-http-fixtures.md).
- [x] Configuration fixtures are CI verified and published: the original 19 mutable files and the read-only assembly consumer use explicit settings; the source inventory of 96 tests finds no legacy imports/writes. Actual durable-conversation and cutover fixtures passed without skips. See the [release record](operations/release-2026-11-07-isolated-resource-fixtures.md).
- [x] Workspace stored-record increment is CI verified and published: policy routing and onboarding physical rows use shared contracts with fixed stored-data errors. Thirty-two focused cases, seven harness checks, both graphs and 87 real PostgreSQL cases passed. See the [release record](operations/release-2026-11-08-workspace-stored-records.md).
- [x] Conversation-record/recovery increment is CI verified and published: unknown pending input is checked before dispatch, invalid items fail independently, and summary/turn views use fixed stored-data errors. Fifteen focused cases, both graphs, seven harness checks and 88 actual SQL cases passed. See the [release record](operations/release-2026-11-08-conversation-record-boundaries.md).
- [x] Judge/reranker response boundaries are validated and published: safe fixed errors, one choice/16-claim bounds, requested rerank cardinality and retained native usage. Twenty-three focused cases, both graphs, seven harness checks and all four fresh CI gates passed. Jina quality/activation stays separate. See the [release record](operations/release-2026-11-08-provider-assessment-boundaries.md).
- [x] Persisted chat replay boundaries are CI validated and published. Six new row/event cases plus actual SQL corruption/isolation/repair preserve cursor/ordering/expiry and reject malformed JSON through the existing fixed server error. All four gates and the repeated exact-source capacity pilot passed. See the [release record](operations/release-2026-11-08-replay-record-boundaries.md).
- [x] Workflow stored-budget and encrypted JSON diagnostics are CI validated and published, including real corrupt/restore SQL and preserved encryption/approval/recovery tests. Input/admission validation, key/AAD formats and budget ceilings remain unchanged. See the [release record](operations/release-2026-11-08-workflow-record-boundaries.md).
- [x] MCP quality-report stored rows are CI validated and published with shared decimal-ratio semantics, preserved zero/null values, bounded pages and rollback/release. Twenty-two focused cases, seven harness checks, both graphs, 91 real SQL cases, the exact-source pilot and both deployments passed. See the [release record](operations/release-2026-11-08-mcp-quality-records.md).
- [x] Ingestion timeline records are CI validated and published: shared stage/status/details schemas, checked driver dates/timing and fixed safe errors. Fourteen focused cases, seven harness checks, both graphs, 92 real SQL cases, the actual pilot and both deployments passed. Fixture cleanup retains the foreign-key constraint. See the [release record](operations/release-2026-11-08-ingestion-event-records.md).
- [x] Usage summary projections are CI validated and published: finite decimal/exponent strings, safe integer counts, checked dimensions/dates and honest empty-window/legacy semantics. Six focused cases, seven harness checks, both graphs and the real SQL NaN corrupt/restore fixture pass. See the [record](operations/release-2026-11-08-usage-summary-records.md) and [combined publication](operations/release-2026-11-08-records-and-capacity.md).
- [x] MCP source/status projections are CI validated and published: six new cases/18 focused passes, Unicode/optional metadata, existing output guards and read-only scope/rollback/release. Two real SQL fixtures pass after correcting setup/cleanup without weakening constraints. See the [record](operations/release-2026-11-08-mcp-ingestion-records.md).
- [x] Full ingestion-job records are CI validated and published through a narrow infrastructure helper: four new cases/17 focused passes, original Buffer identity, payload-free list SQL, null/zero values and admission fallback. Real failed-job corrupt/restore and fresh 95-case SQL proof pass. See the [record](operations/release-2026-11-08-ingestion-job-records.md).
- [x] Partial original/preview projections are CI verified and published: adapter-local driver/nullable-join checks, 28 focused cases, seven harness checks, both graphs, 97 real SQL cases, both short image-based paths and all four normal gates pass. SQL fixtures preserve current-source scope, three-passage ordering/cap, empty joins, private/legacy originals and negative-count repair. Both exact-source deployments and public checks passed. See the [receipt](operations/ingestion-projection-boundaries.md).
- [x] MCP index/passage guarantee review is recorded against the published `ce17d1d` source: physical UUID/provider/model/dimension constraints, configured identity matching, unknown-security blocking, input/output/byte caps and existing actual SQL/cancellation/role fixtures justify retaining the current bounded path. This adds no generic decoder, dependency or production change. See the [review](operations/mcp-projection-guarantees.md); BE-09 activation is separate.
- [x] OAuth client metadata increment is CI verified and published: adapter-local redirect-array decoding reuses the existing canonical callback policy, preserves labels/expiry/nulls and fails with fixed errors before registration commit. Twenty-three focused cases, all seven harness checks, both graphs, the actual SQL corruption/repair fixture and final 99-case SQL gate pass. Both exact-source deployments and public checks pass. See the [record](operations/oauth-client-record-boundaries.md).
- [x] Provider vector representability increment is CI verified and published: reproduced zero/float32-overflow/all-underflow acceptance, then fixed the shared decoder without rounding valid output. Sixteen focused cases, the final harness/graphs, actual SQL conversion/zero-cosine/overflow fixture, 99-case SQL gate and both short image-based paths pass. Reported usage survives invalid responses; both deployments/public checks pass. No historical vectors/cache are rewritten. See the [record](operations/embedding-vector-representability.md).
- [ ] Remaining BE-12: follow the [concrete boundary inventory](backend-configuration-and-records.md#remaining-boundary-inventory-be-12) for action/OAuth/embedding assumptions and document metadata. Preserve existing constraints, optional fields and security guards; targeted decoding does not establish complete SQL coverage.

### FE-05 — Public APIs and a proven FSD gate

- [x] **P2 · M–L · Medium risk · CI verified and published.** Scope: consumed slices across `app`, `pages`,
  `widgets`, `features`, `entities`, narrow `shared` segments and CI.
- **Accept:** external consumers use explicit Public APIs; internal imports stay
  relative; no unnecessary segments or global barrel. Pilot **one** FSD checker
  using the [tool evaluation](frontend-architecture-review.md#tooling-compatibility-and-adoption-decisions).
  Fixtures catch upward/private/page imports, dynamic edges and runtime cycles,
  or explicitly identify gaps covered by the graph check. Legal/type-only edges
  are distinguished; reviewed exceptions cannot silently grow.
- **Preserve:** lazy chunk boundaries. Record before/after entry size and local/CI
  execution time. Do not assume Steiger has a native baseline facility.
- [x] Approve/install one development checker, add 20 slice APIs/48 import changes
  and validate the original 28-fixture pilot with zero production violations.
- [x] Complete the module-layout extension and its local checks. The controlled
  Public API comparison retains 21 JS chunks and entry size; total gzip differs
  by 83 bytes. This does not establish field performance.
- **Evidence:** 61 architecture fixtures and zero current structural/runtime
  violations. Shared contracts build before graph resolution on a clean checkout.
  All four CI jobs and both deployment receipts are recorded in the release evidence.

### BE-08 + FE-08 — Incremental correctness, architecture and test gates

- [x] Bounded compiler stdout diagnostics are CI validated and active in the typecheck harness step. A removed synthetic TS2322 fixture proved visibility/exit/early stop, and the normal harness passed. Other provider/evaluation stdout remains excluded. This does not close promise/Hook tooling. See the [evidence](operations/release-2026-11-08-capacity-source-ownership.md).

- [ ] **P2 · M per track · Medium risk.** Scope: workspace scripts, TypeScript,
  selected lint/graph configuration, CI and focused frontend test helpers.
- **Accept:** a pinned compatible pilot catches meaningful promise/Hook/import
  defects; local and CI checks agree. Resolve the remaining backend unused-symbol
  diagnostics (six at `d045949`) before enabling those options. Add focused session/cache/decoder/
  chat transition tests; retain current API/PostgreSQL/Playwright/axe gates.
- **Preserve:** reviewed exceptions and existing visual baselines. Do not install
  a bundle of overlapping lint/FSD/test tools, mass-format the repository or add
  tests that merely mirror trivial code. Choose a DOM test tier only where useful.
- **Partial:** dependency checks and focused session/cache/decoder/navigation
  regressions exist. The native unused-symbol slice is implemented: the six
  diagnostics were removed and API `noUnusedLocals`/`noUnusedParameters` are now
  enabled, with passing strict checks, harness/CI and deployment at `2fcd121`.
  The follow-up [native return/unused increment](operations/release-2026-11-07-native-quality.md)
  is CI verified and published: both workspaces enforce return/fallthrough checks and
  web also enforces unused symbols. Its five diagnostics are resolved without
  changing public props/exports.
  Promise/Hook correctness remains open;
  the graph gate and native flags do not cover it. Publication is tracked in the
  [query-ownership release record](operations/release-2026-11-07-query-ownership.md).

## Phase 3 — Async reliability, least privilege and cost

### FE-06 — Query cancellation and polling ownership

- [x] **P2 · M · Medium risk · CI verified and published at `c72702e`.** Scope: ingestion/evaluation/usage query functions,
  saved conversation polling and shared request deadlines.
- **Accept:** all relevant reads consume their AbortSignal; disposed scope requests
  abort; settled inactive surfaces stop short-interval polling. Active durable
  jobs still reconcile. Record request-count reduction without duplicate mutation
  or provider calls; test offline, 401/403/429 and navigation while loading.
- **Current evidence:** administrative reads forward Query's signal and use
  explicit resource deadlines. Idle/error interval ownership and terminal
  invalidation are implemented. Conversation visibility, incremental windows and
  execution-reader ownership now have passing focused verification. Provider-
  backed search is not classified as a cheap metadata GET.
- [x] **Administrative read slice, CI verified and published at `2fcd121`:**
  explicit ten-second metadata/resource reads compose caller cancellation with
  the deadline. Document lists no longer poll. One mounted workspace monitor
  owns the active-job interval and invalidates all document-filter variants and
  Ask readiness once per observed terminal revision. Failed jobs/evaluations/
  usage reads stop interval retries; approval-only evaluations wait quietly.
  Focus/reconnect and explicit retry remain available. Visible owner usage keeps
  its 30-second refresh and disposes it on section exit. Settled Ask readiness
  uses slower 30-second reconciliation instead of a three-second empty-library
  loop. Search/provider calls, writes, original-file blobs and conversation
  transports retain their current budgets and semantics.
- **Measured local evidence:** new browser request counters cover idle and
  active-to-terminal behavior, filtered/unfiltered invalidation, one deliberate
  approval, 401/403/429, invalid success data, offline/reconnect, finite deadlines
  and read disposal. Thirty focused cases passed across all three profiles;
  the complete local harness and 78 architecture fixtures passed. All four CI
  gates and both deployments passed; evidence is in the release record. The full
  gate caught a demo-readiness regression, fixed by an explicit terminal-source
  notification while retaining original tests/baselines. Conversation
  pagination/transport work below is implemented, validated and published; its
  [release record](operations/release-2026-11-07-conversation-readers.md) separates
  exact-source CI and publication from the earlier administrative delivery.
- **Conversation scope:** keep durable capability independent from read visibility,
  select one active-run transport owner, and refresh only newest messages rather
  than every loaded infinite-query page. Do not turn navigation into cancellation
  or repeat a submission. Keep the intentional visible owner usage refresh.
- **Verify:** request counters for idle/active/failed states, disposal/deadline
  aborts, section navigation, one explicit cancellation and a 75-message history
  that retains older pages while refreshing only the newest. Use existing
  Playwright/clock fixtures and QueryProvider's actual retry setting.

- **Final evidence:** 45 focused model/browser checks preserve 75 visited turns,
  cursors, old feedback and scroll; pause invisible reads; keep SSE/HTTP/comparison
  readers exclusive; reconcile exhausted SSE; abort disposed reads; and retain one
  confirmed admission across read retry/reload. All four exact-source CI gates and
  both deployments passed. The separate FE-07 lifecycle follow-up is now also
  completed below.

### FE-07 — Explicit chat lifecycle transitions

- [x] **P2 · M–L · High risk.** Scope: `features/question-answering/model/`
  conversation, saved-message, streaming and reconciliation hooks.
- **Accept:** discriminated unions reject impossible turn states. Focused tests
  cover submission retries, create/navigation overlap, delayed completion,
  repeated stream event IDs, reconnect after terminal state and explicit cancel.
  Idempotent submission retains one ordered conversation/run. Use native unions/
  reducers before evaluating a state-machine library.
- **Completed and published:** native correlated chat/delivery unions
  reject invalid result states, including nine compile-time negative checks.
  Conversation creation is bound before selection, retries retain their draft ID,
  and late creation cannot navigate or admit work after a selection/route change.
  Reader/Stop results require the same execution ID; unconfirmed Stop keeps
  reading, concurrent completion is retained, and duplicate/replayed SSE IDs do
  not append twice. Sending and Stop have explicit pending states.
  Seventy-five focused checks passed across three viewports, preserving all
  FE-06 window/reader scenarios. The seven-check local harness and 78 architecture
  fixtures passed. All four exact-source CI gates and both deployments passed;
  served lifecycle assets, health and protected routes were verified.
  See [lifecycle evidence](operations/release-2026-11-07-chat-lifecycle.md).

### BE-09 — Dedicated MCP read privileges

- [ ] **P2 · M · High risk · Activation gate: stronger least-privilege deployment.**
  Scope: `MCP_READ_DATABASE_URL` handling in `bootstrap.ts`, database grants and
  role-based integration fixtures.
- **Accept:** production MCP requires its explicit minimum read-role connection;
  write, DDL and unapproved reads fail under that credential; tenant/member
  checks remain effective. Verify grants and rollback before changing deployment.
  Read-only transactions alone do not prove credential isolation.

### BE-10 — Conservative paid-reranker reservations

- [x] **P2 · M · Medium risk · CI verified and published. Activation gate: paid reranker.** Scope:
  `infrastructure/security/workflow-provider-guards.ts` and independent reranker rate config.
- **Accept:** reservation reflects bounded candidate/input size and approved
  rates rather than a fixed 1,000 micros. Insufficient budget prevents invocation;
  retries/overrun/error cases retain accounting provenance. No guard claims to
  reverse a charge already incurred remotely. Golden-set approval remains required.
- **Evidence:** 16 focused unit and five actual PostgreSQL cases cover input/rate
  bounds, safe fallback, replay and atomic native-overrun terminalization. A failed
  terminal commit remains explicitly `effect_outcome_unknown`; measured usage is
  retained. Paid production activation and a reviewed Jina benchmark remain open.

### BE-11 — Single-flight bounded shutdown

- [x] **P2 · M · High risk · CI verified and published.** Scope: `server.ts`, legacy ingestion execution,
  resource lifecycle and supported worker-mode documentation.
- **Accept:** repeated signals stop admission once, propagate cancellation,
  drain within a deadline and close resources in `finally`. Provider/OCR/SQL
  wait tests preserve interrupted-versus-completed and recovery semantics.
  Always-on worker topology follows measured requirements and cost review.
- **Evidence:** repeated real SIGTERM, uncooperative work, independent resource
  cleanup, source/OCR/provider abort, late completion and real SQL wait/rollback
  pass. The shared shutdown is capped at 25s. See the
  [shutdown runbook](operations/server-shutdown.md) for recovery limits.

### BE-14 — Dependency, Node and production-build hygiene

- [ ] **P2 · M · Medium risk.** Scope: root/workspace manifests and lockfile,
  TypeScript build targets, API Dockerfile and Auth/MCP/session/native OCR tests.
- **Accept:** review reachability of the two low Auth-chain findings and apply
  a compatible fix with regression evidence. Align the declared Node minimum
  with tested tooling/CI. Separate test artifacts only while preserving actual
  image-level Poppler/Tesseract smoke validation. Evaluate native dependency/
  static-analysis automation with explicit scope; no uncontrolled major upgrades.
- [x] Align manifest/`.nvmrc` with the existing Node 24 CI/container baseline.
- [x] Production/test-artifact separation is CI verified and published. Explicit runtime roots, clean output inventory and a separate mandatory two-pass native OCR stage are implemented. The final image contains no project test/helper files. See the [release record](operations/release-2026-11-07-runtime-artifacts.md) for actual image checks and the local Docker disk limit.
- [x] Actual minimal MCP image/permission handshake passed in fresh CI, including five tools, restricted runtime and rejection of the unavailable write tool. The [image gate](operations/mcp-image-verification.md) is required on every release.
- [x] Runtime SQL resources and safe migration CLI failures are published. Fresh CI matched all 31 source/image files by digest, applied 31 migrations and reapplied zero using the actual read-only API image. Both production images include the catalog. See the [receipt](operations/release-2026-11-08-runtime-migration-resources.md). No hosted migration or SDK upgrade is included.
- [ ] Apply the reviewed compatible Auth fix with its complete regression/release evidence. The candidate SDK has not been installed.
- **Review evidence:** the [dated dependency/OCR review](operations/dependency-hygiene-2026-11-07.md)
  verifies that two low audit entries represent one Auth advisory. The only
  affected application sink rejects malformed IDs before any request; a mocked
  raw-SDK comparison confirms the underlying routing behavior. SDK `2.50.0`
  is the smallest reviewed vendor candidate, but it has not been installed or
  released. Dependency versions remain unchanged. Native OCR is preserved by the published verified artifact. The compatible SDK update remains a separate uninstalled decision.

### BE-16 — Production authentication for legacy JSON ingestion

- [x] **P1 · S · High security impact, bounded compatibility risk · CI verified and published.** Scope:
  HTTP production policy, ingestion controller, environment guidance and route
  regressions. All four gates, the exact-source pilot and both deployments passed.
- **Finding:** without DEMO_MODE or a global API_KEY, production queries require
  identity but the older POST /v1/documents route can admit a default-corpus
  write. Reproduced with synthetic dependencies (201 before the fix). The current
  hosted demo rejects an empty unauthenticated request; no incident is claimed.
- **Accept:** production without global key requires a configured matching
  admin key before schema/quota/ingestion/audit. Preserve demo/global-key and
  local-study paths; bearer/workspace headers cannot grant default-corpus
  maintenance. Keep product uploads under existing membership/RBAC. Six new
  native route cases and all normal release gates must pass.
- See the [finding and evidence](operations/release-2026-11-08-legacy-ingestion-auth.md).

## Phase 4 — Consistency and evidence-led performance

### BE-15 — Technology-neutral modules and replaceable capabilities

- [x] **P2 · L, incremental · High risk · Implemented, CI passed and published.**
  Scope: module factories and application ports, `app/composition`, provider
  registry bindings and architecture checks. See
  [ADR 0003](decisions/0003-technology-neutral-modules.md).
- **Problem at `d045949`:** module factories accept `pg.Pool`, construct vendor
  adapters, create LangGraph/LangSmith workflows or branch on provider SDK names.
  Some feature configuration types also expose vendor environment keys.
- **Implement:** inject feature-specific repository/service ports, plain workflow
  factories/decorators and backend-owned provider capabilities. Outer composition
  selects current concrete adapters. Keep real policy/use-case assembly in
  modules; avoid pass-through service/factory wrappers and generic SQL/CRUD APIs.
- **Accept:** application/domain/module factories import no vendor SDK, concrete
  infrastructure, `Pool`, LangGraph state/saver or LangSmith type. Alternate typed
  fake repositories/workflows/no-op tracing and a newly registered fake provider
  work without new business-policy branches. Architecture fixtures prevent both
  runtime and type-only regressions; current configured-adapter suites still pass.
- **Preserve:** HTTP contracts, server allowlists, redaction, dimensions/index
  versions, cache/checkpoint/fingerprint identities, usage provenance, budgets,
  tenant scope, authorization, fenced transactions and resource ownership. No
  schema/package/framework migration is needed for the boundary refactor.
- **Limits:** replacing persistent state engines/databases and embedding models
  requires compatibility/migration evidence. Capability equivalence is verified,
  not assumed from matching method names. Live activation remains explicit.
- **Evidence:** seven-check harness passed; 78 architecture fixtures and both
  dependency graphs passed without violations; 104 focused HTTP/workflow/assembly
  cases, 83 PostgreSQL cases and the isolated embedding cutover passed with zero
  skips. Two native OCR tests passed using the clean compiled code with the
  unchanged verified native dependency image. Alternative provider/workflow/
  tracing/repository/engine tests preserve budgets, redaction, signatures and
  tenant authorization. Both new same-client completion regressions prove rollback
  on post-insert failure and lease expiry. All four exact-source CI jobs and both
  deployments passed at `cbd0f67`; see the release record for IDs and production
  checks. No schema or runtime dependency changed.

### FE-09 — Semantic tokens and existing primitive consolidation

- [x] **P2 · M · Medium risk.** Scope: `styles.css`, `shared/ui`, original-file
  dialog and source/evidence domain presentation.
- **Accept:** migrated actions share hover/focus/disabled/pending tokens; compatible
  dialogs share Overlay with focus restoration and safe object-URL cleanup.
  Keyboard, select-in-dialog, contrast, reduced-motion and three-viewport checks
  pass. Preserve Radix and text escaping; do not bundle a product-wide redesign.
- **Completed and published:** semantic action tokens preserve the current
  palette/dimensions; compatible dialogs share Overlay, including compact
  creation/member/original-file dialogs. Focus restores to the opener or a stable
  fallback when it was removed. File reads are bounded/abortable and own their
  blob URLs. Source/evidence UI now belongs to `entities/source` with a Public API.
  The local run passed 98 focused cases/10 intentional profile exclusions,
  78 architecture fixtures, zero graph violations and all seven harness checks.
  No dependency or backend contract changed. See the [primitive guide](frontend-primitives.md)
  and [release evidence](operations/release-2026-11-07-ui-primitives.md).
  All four exact-source CI gates and both deployments passed; public CSS/assets,
  health and protected routes were verified. Existing visual baselines are unchanged.

### FE-10 — Repeatable frontend performance baseline

- [x] **P2 measurement · S, then measured follow-ups · Low measurement risk.**
  Scope: Vite build artifacts, private-route loading and long-chat interaction.
- **Accept:** record environment, entry/chunk gzip size, route/request counts and
  streaming/long-history profiles. Establish reviewed regression budgets. Any
  optimization reports before/after results and preserves keyboard/backscroll/
  pinned-scroll behavior. No claim of better LCP without measurements; no automatic
  memoization, table or virtualization dependency.
- **Completed and published (measurement track):** native build-size inspection,
  versioned gzip baseline, explicit expiry/review metadata for exceptions, route
  request gates and three-profile long-history/stream profiles are implemented.
  The measured admission-time message read is removed (5 → 4 total history reads
  for the 75-turn workload), with 90 focused checks preserving FE-06/FE-07.
  Native budget tests and per-commit build/browser artifacts are integrated into
  CI. No dependency, broad memoization or virtualization was added.
  See the [performance guide](frontend-performance.md). Field/RUM performance and
  LCP improvement are not claimed; later optimizations require separate evidence.
  All four exact-source CI gates and both live deployments passed. See the
  [release record](operations/release-2026-11-07-frontend-performance.md).

### BE-13 — Mixed-workload capacity and tenant fairness

- [ ] **Hosted demo validation explicitly pending:** run a separately bounded end-to-end cohort using actual Render hosting, Supabase Auth/PostgreSQL and the selected real OpenRouter model. Declare synthetic scope, deployment/model identity, duration/request/concurrency/spend limits and stop conditions before execution. Retain real latency/usage/error evidence and a safe comparative report; passing the isolated cohort certifies only its declared conditions. See [production capacity and operations](backlog.md#6-production-capacity-and-operations). The completed [observability inventory](operations/observability-review-2026-11-08.md) verifies active logs/product metrics and disabled LangSmith/OTLP; safe streamed trace coverage and actual receiver delivery remain follow-ups.

- [x] **Instrumented sustained cohort validated:** source `75f7583` passed all four normal CI jobs and the fixed 30-minute/50,000-chunk/ten-workspace workload: 10,022 mixed pairs, zero unexpected failures, six completed unique ingestions and all new-source checks. Both phase event-loop/guarded-checkout windows, 618 queue/resource observations, 10,392 completed chat rows, six ingestion rows, 62,364 checkpoints and safe cleanup are reviewed. Search p95 is 204.445 ms; validated completion p95 is 2,510.180 ms. The old report stays immutable; provider/hosting, source/runner and partial measurement caveats remain explicit. No application change or redeployment was needed. See the [process and comparative result](operations/capacity-instrumented-sustained-result.md).

- [x] Guarded API checkout measurement is validated and published at `151ccef`: the existing OpenTelemetry API records acquisition/cancellation/failure duration without SQL or identities. Seven native cases, eighteen capacity/probe cases, the max=1 real-SQL contention/cancellation fixture, both actual version-three short image-based paths and all four normal CI jobs pass. Both exact-source services and public checks are verified. Direct pool queries and pure queue wait remain unmeasured; hosted metric export is not activated. See the [measurement and release evidence](operations/postgres-checkout-measurement.md).

- [x] Scoped durable queue/ready/running/lease/approval measurements are validated and active in CI at `2c2ed48`: 15 native cases, both actual image-based pilots and all four normal jobs pass. Six-row pre-start SQL fixtures prove readiness, disjoint leases, ages, scope and exact cleanup without dispatching work. Both pilots retain 14 valid runtime observations. This measures states, not recovery or sustained capacity. See the [evidence](operations/capacity-workflow-queues.md).

- [x] The lab-only native API-process probe is active and validated in CI: 14 native cases, both actual version-two short profiles and all normal gates pass. No dependency/exporter or production endpoint is added. Empty samples stay unknown and pool wait remains separate. Earlier reports are unchanged. See the [measurement evidence](operations/capacity-event-loop-plan.md).

- [x] Fixed pilot/durable-pilot/sustained profiles and safe diagnostics are validated (12 native cases and all four normal CI jobs). Both short image-based paths passed at `39547aa`; the durable database has 93 completed chats, six completed ingestions and 502 checkpoints. The earlier queue-start instrumentation mismatch is recorded. The later sustained result is recorded separately; these short runs are not production scale evidence. See the [bounded plan](operations/capacity-sustained-plan.md).
- [x] The first sustained experiment passed at pinned source `7c37d96`: ten workspaces/50,000 chunks, ten clients, 30 mixed minutes, 7,748 mixed pairs, six completed ingestions and zero unexpected failures. The [reviewed result](operations/capacity-sustained-result.md) retains per-workspace measurements, observed waits and missing metrics. This does not close BE-13 or certify production scale.

- [x] Authoritative fixture ownership for newly ingested IDs and chunk/document pairing are CI validated. Nine native cases, the full normal gates and the actual lab passed, including six new-source searches/answers and six scoped ownership lookups. This is not the sustained baseline. See the [evidence](operations/release-2026-11-08-capacity-source-ownership.md).

- **Measured, ticket partial:** the [first sustained result](operations/capacity-sustained-result.md) and separate [instrumented sustained cohort](operations/capacity-instrumented-sustained-result.md) retain their exact sources and measurement coverage. Native event-loop, workflow queues/leases and guarded acquisition now have long-run evidence. Pure pool queue wait, remaining direct-query paths, large-file/reindex/evaluation bursts, restart/slow-reader/cancellation pressure, tenant flood and replica scenarios remain open, along with separately budgeted real-provider/hosted measurements. No production topology change or exact checkout percentile is inferred from these synthetic runs.

- [ ] **P2 measurement · M–L · Medium operational risk.** Scope:
  [capacity plan](backend-scalability-review.md), synthetic load fixtures,
  query plans, pool/worker/provider budgets and trusted-proxy policy.
- **Accept:** reproducible corpus/tenant-skew/stream/upload scenarios capture p95,
  first stream event, recall, pool wait, locks, queue age, event-loop delay and cost.
  Prove behavior of a busy tenant and multi-replica burst limiting before scaling.
  Record the decision and triggers for a dedicated worker/shared limiter/vector
  topology. Stub paid providers for the baseline; authorize separate live-cost runs.

### FE-11 — Focused form and URL-state normalization

- [x] **P3 · M across small flows · Medium risk · CI verified and published.** Scope: native route subscriptions,
  safe section/conversation/filter serialization and repeated form conventions.
- **Accept:** back/forward restores the intended safe state once; question text,
  tokens and sensitive drafts never enter URLs. Accessible field errors and drafts
  survive recoverable failures in PT/EN. Keep simple forms native; evaluate a form
  library only for demonstrated complexity.

- **Published implementation:** one native history subscription, canonical UUID/metadata codecs, workspace scope cleanup, recoverable answer/comparison drafts and accessible filter/import errors. All 21 browser profile cases and four native state cases passed; the release record retains local/CI limitations. No form/router dependency was added. See the [state guide](frontend-url-state.md) and [evidence](operations/release-2026-11-07-url-state.md).

## Parallel execution and release rules

The first independent tracks can be FE-01/FE-03 and BE-01/BE-03/BE-04. Coordinate
FE-02a/BE-02 as one transport contract correction. Give `app.ts`, `bootstrap.ts`,
shared contracts and CI configuration one editor per change; those are overlap
points rather than safe independent file moves. BE-06 precedes broad BE-07 auth
extraction; FE-04 precedes enforcement of page-boundary rules in FE-05.

For every ticket:

1. Record the focused regression and intended public behavior before changing it.
2. Keep behavior changes, moves, formatting and dependency adoption reviewable.
3. Run affected tests and the existing release harness; use actual PostgreSQL
   for transactions/grants and real parser transport for header contracts.
4. Document scope, risk, rollback and results. No paid provider or real email is
   required for routine CI; live activation has its own explicit evidence.
5. Update this checklist and the product backlog only after validation. Record
   code SHA, CI run and deployment status separately; a plan or passing local
   test does not make a capability live.

No AWS, Terraform, GitLab, Redis, alternative ORM/router/UI framework, new hosted
monitoring backend or write-capable MCP action is introduced by this review.
Those remain separate scoped decisions in the product backlog.
