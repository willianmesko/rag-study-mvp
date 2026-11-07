# Technical architecture backlog

Reviewed on **2026-11-07**, against source commit
`e25572d6118efbdb84190367a039526775fbd0b2`.

The backend and frontend reviews were performed in parallel. **The analysis and
planning are complete; all 25 implementation tickets below are pending.** No
application code, dependency, API contract or infrastructure was changed by this
audit. Product work and live activation remain in the [product backlog](backlog.md).

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
audited source commit and may move after implementation.

## Phase 1 — Correct boundaries and protect operational activation

### BE-01 — Stable encryption-key inventory

- [ ] **P1 · M · High risk · Activation gate: reader-key retirement.** Replace
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

- [ ] **P1 · S–M first slice · Medium risk.** Fix JSON headers on body-bearing
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

- [ ] **P1 pool listener, P2 SQL limits · S–M · Medium risk.** Scope:
  `infrastructure/postgres/pool.ts` and bounded transaction/query helpers.
- **Accept:** an idle-client disconnect emits a safe fixed reason and does not
  terminate the service; a replacement connection works. Retrieval sleep/lock
  tests, caller cancellation and failed-transaction reuse prove cleanup and
  workload-specific limits. Inventory actual role/DSN defaults before changing
  them; do not impose retrieval deadlines on migrations/index construction.

### FE-01 — Credential-free cache identity and auth transitions

- [ ] **P1 · M · High risk.** Scope: `pages/rag-lab`,
  `app/providers/QueryProvider.tsx`, workspace query factories,
  `widgets/workspace-control-center/model/queries.ts` and saved conversations.
- **Accept:** no sentinel bearer token appears in query keys; same-user token
  refresh reuses data; manual/cross-tab logout and account changes cancel/remove
  old private queries consistently. Delayed old-user/workspace results cannot
  repaint the new scope. Keep explicit identity isolation and keyed scope resets.
- **Preserve:** navigation may detach a stream without cancelling its durable
  server run. There is no claim of a demonstrated cross-user disclosure.

### FE-03 — Local recovery boundaries and safe diagnostics

- [ ] **P1 · S–M · Medium risk.** Scope: `app/ErrorBoundary.tsx`, workspace lazy
  sections, chat/onboarding composition and a minimal diagnostic adapter.
- **Accept:** injected lazy-load/render failures leave navigation and another
  section usable, expose an accessible recovery action and recover without retry
  loops. Recorded diagnostics exclude sentinel prompts, sources and credentials.
  Retain a root fallback for genuinely global failures; no monitoring vendor is
  installed as part of this correction.

### BE-04 — Complete budget-alert repair window

- [ ] **P1 · M · Medium risk · Activation gate: unattended budget webhook.**
  Scope: ledger recording in `bootstrap.ts`,
  `infrastructure/observability/budget-alerts.ts` and outbox recovery tests.
- **Accept:** a crash after ledger commit/before enqueue, followed by 25 hours
  offline and no further provider calls, still discovers the threshold in the
  full 30-day window. Concurrent/paginated repair creates one stable delivery
  identity. Prefer atomic intent/watermark; a bounded full-window discovery is
  a smaller first fix. Preserve receiver deduplication and at-least-once semantics.

### BE-05 — Execute embedding-index cutover tests in CI

- [ ] **P1 · S–M · Medium risk · Activation gate: live embedding migration.**
  Scope: `.github/workflows/quality-gates.yml`, existing
  `pg-workspace-embedding-index.integration.test.ts` and its database fixture.
- **Accept:** CI creates a separately named disposable cutover database, loads
  Auth fixtures/migrations and runs `npm run test:embedding:index` without skips.
  Rebuild, dimensions, tenant isolation, concurrent ingestion, cache invalidation,
  activation and rollback are verified. Keep destructive fixtures unable to use
  a shared/live database.

## Phase 2 — Establish durable module and contract boundaries

### BE-06 — Bounded authentication and scoped member lookup

- [ ] **P2 · M · High risk.** Scope: workspace/member authorization in
  `interfaces/http/app.ts`, new small Auth ports and existing Supabase adapters.
- **Accept:** one verified request principal, bounded SDK transport and separate
  public/admin clients; membership-ID-first directory lookup works for a project
  with more than 1,000 Auth users without listing unrelated accounts. Revoked
  membership still blocks access. Validate signing/cache/revocation semantics
  before substituting `getClaims` for `getUser`; the installed SDK has both.

### BE-07 — Cohesive Fastify route plugins and composition

- [ ] **P2 · L, split by capability · High risk.** Scope:
  `interfaces/http/app.ts`, `bootstrap.ts`, route modules and typed factories.
- **Accept:** HTTP plugins receive narrow typed dependencies; vendor calls stay
  in adapters; application policies use ports; composition owns resources once.
  Existing API/RBAC/idempotency tests retain behavior without assertion-heavy
  partial dependency objects. Preserve atomic fenced transactions. No IoC,
  generic repository framework or framework migration is required.

### FE-04 — Application-owned routes, session and workspace orchestration

- [ ] **P2 · L, incremental · High risk.** Scope: `app/App.tsx`,
  `pages/rag-lab/ui/RagLabPage.tsx`, shell composition and native route adapter.
- **Accept:** pages no longer import other pages; `app` owns routing/auth/workspace
  composition. Sign-in, invitation, incomplete onboarding, MCP consent, browser
  history and different roles in two workspaces preserve URLs and behavior.
  Retain one session subscription; no new router/global store is assumed.

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

### FE-05 — Public APIs and a proven FSD gate

- [ ] **P2 · M–L · Medium risk.** Scope: consumed slices across `app`, `pages`,
  `widgets`, `features`, `entities`, narrow `shared` segments and CI.
- **Accept:** external consumers use explicit Public APIs; internal imports stay
  relative; no unnecessary segments or global barrel. Pilot **one** FSD checker
  using the [tool evaluation](frontend-architecture-review.md#tooling-compatibility-and-adoption-decisions).
  Fixtures catch upward/private/page imports, dynamic edges and runtime cycles,
  or explicitly identify gaps covered by the graph check. Legal/type-only edges
  are distinguished; reviewed exceptions cannot silently grow.
- **Preserve:** lazy chunk boundaries. Record before/after entry size and local/CI
  execution time. Do not assume Steiger has a native baseline facility.

### BE-08 + FE-08 — Incremental correctness, architecture and test gates

- [ ] **P2 · M per track · Medium risk.** Scope: workspace scripts, TypeScript,
  selected lint/graph configuration, CI and focused frontend test helpers.
- **Accept:** a pinned compatible pilot catches meaningful promise/Hook/import
  defects; local and CI checks agree. Resolve nine extra backend unused-symbol
  diagnostics before enabling those options. Add focused session/cache/decoder/
  chat transition tests; retain current API/PostgreSQL/Playwright/axe gates.
- **Preserve:** reviewed exceptions and existing visual baselines. Do not install
  a bundle of overlapping lint/FSD/test tools, mass-format the repository or add
  tests that merely mirror trivial code. Choose a DOM test tier only where useful.

## Phase 3 — Async reliability, least privilege and cost

### FE-06 — Query cancellation and polling ownership

- [ ] **P2 · M · Medium risk.** Scope: ingestion/evaluation/usage query functions,
  saved conversation polling and shared request deadlines.
- **Accept:** all relevant reads consume their AbortSignal; disposed scope requests
  abort; settled inactive surfaces stop short-interval polling. Active durable
  jobs still reconcile. Record request-count reduction without duplicate mutation
  or provider calls; test offline, 401/403/429 and navigation while loading.

### FE-07 — Explicit chat lifecycle transitions

- [ ] **P2 · M–L · High risk.** Scope: `features/question-answering/model/`
  conversation, saved-message, streaming and reconciliation hooks.
- **Accept:** discriminated unions reject impossible turn states. Focused tests
  cover submission retries, create/navigation overlap, delayed completion,
  repeated stream event IDs, reconnect after terminal state and explicit cancel.
  Idempotent submission retains one ordered conversation/run. Use native unions/
  reducers before evaluating a state-machine library.

### BE-09 — Dedicated MCP read privileges

- [ ] **P2 · M · High risk · Activation gate: stronger least-privilege deployment.**
  Scope: `MCP_READ_DATABASE_URL` handling in `bootstrap.ts`, database grants and
  role-based integration fixtures.
- **Accept:** production MCP requires its explicit minimum read-role connection;
  write, DDL and unapproved reads fail under that credential; tenant/member
  checks remain effective. Verify grants and rollback before changing deployment.
  Read-only transactions alone do not prove credential isolation.

### BE-10 — Conservative paid-reranker reservations

- [ ] **P2 · M · Medium risk · Activation gate: paid reranker.** Scope:
  `infrastructure/security/workflow-provider-guards.ts` and independent reranker rate config.
- **Accept:** reservation reflects bounded candidate/input size and approved
  rates rather than a fixed 1,000 micros. Insufficient budget prevents invocation;
  retries/overrun/error cases retain accounting provenance. No guard claims to
  reverse a charge already incurred remotely. Golden-set approval remains required.

### BE-11 — Single-flight bounded shutdown

- [ ] **P2 · M · High risk.** Scope: `server.ts`, legacy ingestion execution,
  resource lifecycle and supported worker-mode documentation.
- **Accept:** repeated signals stop admission once, propagate cancellation,
  drain within a deadline and close resources in `finally`. Provider/OCR/SQL
  wait tests preserve interrupted-versus-completed and recovery semantics.
  Always-on worker topology follows measured requirements and cost review.

### BE-14 — Dependency, Node and production-build hygiene

- [ ] **P2 · M · Medium risk.** Scope: root/workspace manifests and lockfile,
  TypeScript build targets, API Dockerfile and Auth/MCP/session/native OCR tests.
- **Accept:** review reachability of the two low Auth-chain findings and apply
  a compatible fix with regression evidence. Align the declared Node minimum
  with tested tooling/CI. Separate test artifacts only while preserving actual
  image-level Poppler/Tesseract smoke validation. Evaluate native dependency/
  static-analysis automation with explicit scope; no uncontrolled major upgrades.

## Phase 4 — Consistency and evidence-led performance

### FE-09 — Semantic tokens and existing primitive consolidation

- [ ] **P2 · M · Medium risk.** Scope: `styles.css`, `shared/ui`, original-file
  dialog and source/evidence domain presentation.
- **Accept:** migrated actions share hover/focus/disabled/pending tokens; compatible
  dialogs share Overlay with focus restoration and safe object-URL cleanup.
  Keyboard, select-in-dialog, contrast, reduced-motion and three-viewport checks
  pass. Preserve Radix and text escaping; do not bundle a product-wide redesign.

### FE-10 — Repeatable frontend performance baseline

- [ ] **P2 measurement · S, then measured follow-ups · Low measurement risk.**
  Scope: Vite build artifacts, private-route loading and long-chat interaction.
- **Accept:** record environment, entry/chunk gzip size, route/request counts and
  streaming/long-history profiles. Establish reviewed regression budgets. Any
  optimization reports before/after results and preserves keyboard/backscroll/
  pinned-scroll behavior. No claim of better LCP without measurements; no automatic
  memoization, table or virtualization dependency.

### BE-13 — Mixed-workload capacity and tenant fairness

- [ ] **P2 measurement · M–L · Medium operational risk.** Scope:
  [capacity plan](backend-scalability-review.md), synthetic load fixtures,
  query plans, pool/worker/provider budgets and trusted-proxy policy.
- **Accept:** reproducible corpus/tenant-skew/stream/upload scenarios capture p95,
  first stream event, recall, pool wait, locks, queue age, event-loop delay and cost.
  Prove behavior of a busy tenant and multi-replica burst limiting before scaling.
  Record the decision and triggers for a dedicated worker/shared limiter/vector
  topology. Stub paid providers for the baseline; authorize separate live-cost runs.

### FE-11 — Focused form and URL-state normalization

- [ ] **P3 · M across small flows · Medium risk.** Scope: native route subscriptions,
  safe section/conversation/filter serialization and repeated form conventions.
- **Accept:** back/forward restores the intended safe state once; question text,
  tokens and sensitive drafts never enter URLs. Accessible field errors and drafts
  survive recoverable failures in PT/EN. Keep simple forms native; evaluate a form
  library only for demonstrated complexity.

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
