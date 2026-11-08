# Backlog resume checkpoint

Recorded on **2026-11-07** after the owner requested resuming later from the same
point. The owner subsequently requested the specific BE-15 abstraction follow-up;
that follow-up is now validated and published. General continuation has resumed
with the FE-06 administrative slice and BE-08 native TypeScript checks below;
both are published. The remaining FE-06 conversation slice is also validated
and published. FE-07, FE-09, FE-10 and FE-11 are also complete and published.

## Current delivery

- Source: `bbc1adad13e958ed952ba22d2dfb203a5bd692c7`.
- [CI run](https://github.com/willianmesko/rag-study-mvp/actions/runs/42444829972).
- [Release evidence](operations/release-2026-11-08-records-and-capacity.md) records
  all four green CI jobs, both observed live deployments and production checks.
  A source push alone is not publication.
- Feature modules, response contracts, bounded identity/SQL, resource lifecycle,
  conservative reranking and FSD/module checks are in that delivery. Capability
  ports and outer adapter bindings now isolate the business factories from
  concrete database, model, graph and tracing implementations.
- Administrative resource deadlines/polling ownership and API native unused
  checks are included. FE-06 is complete; BE-08/FE-08 retain promise/Hook work.
- [Learning walkthrough](learning-walkthrough.md): an 18-chapter plan is saved.
  The teaching sessions and learner outcomes remain pending.

The saved administrative and native TypeScript slices are now implemented.
Their [release record](operations/release-2026-11-07-query-ownership.md) records
all four green CI gates, both live deployments and production checks. No conversation
transport or pagination refactor has been bundled into the administrative slice.

## Latest autonomous checkpoint, 2026-11-08 UTC

The [combined record](operations/release-2026-11-08-records-and-capacity.md)
confirms published usage/MCP/full-job boundaries at bbc1ada, all four green
normal jobs, 95 real SQL cases, both observed live services and public checks.
The [sustained result](operations/capacity-sustained-result.md) is separately
pinned to 7c37d96; the [native probe](operations/capacity-event-loop-plan.md) has
separate final-source short-run evidence. No unmeasured value was backfilled.
The first two learning chapters are prepared, with learner outcomes still open.

The [queue measurement follow-up](operations/capacity-workflow-queues.md) is also
validated and active in CI at `2c2ed48`: 15 native cases, both actual SQL/image
pilots and all four normal jobs pass. Both retain 14 valid queue observations;
the durable run has 99 completed chats, six ingestions and 526 checkpoints.
This tooling-only change needs no application deployment; live source remains
`bbc1ada`. Recovery and sustained queue capacity are not claimed.

Next safe measurement: API checkout wait before making a scaling decision,
then a sustained run with the new instrumentation. Remaining BE-12 projection work needs concrete sink/
constraint review; avoid blanket decoder or library additions. Pending tooling,
minimum-privilege credentials, SDK adoption and paid/exporter activation retain
their explicit separate decisions. Do not mark partial tickets complete.

## Completed bounded delivery and next work

FE-11 and the bounded BE-12 configuration/record increment are now validated and
published together. The native route tests run outside Playwright's transform;
valid saved UUIDs and invalid/private query fields have explicit coverage. No
visual baseline changed. Full CI passed 410 UX checks, 85 PostgreSQL checks and
the remaining recorded gates. The receipts distinguish public smoke checks from
synthetic authorized flows and remaining BE-12 scope:

- [FE-11](operations/release-2026-11-07-url-state.md)
- [BE-12 increment](operations/release-2026-11-07-configuration-records.md)

BE-14's artifact portion is now published, including actual Render OCR/clean-tree
receipts and all four green gates. Dependency versions are unchanged. Automatic
continuation published provider-specific deadlines/lazy HTTP configuration and
the [real minimal-MCP-image CI check](operations/mcp-image-verification.md).
The bounded embedding-response increment and native return/unused checks are
also published. Checked provider chat frames and the four-family explicit HTTP
fixture migration are now published together. Remaining configuration fixtures
and workspace stored-record decoding are also published after 87 real SQL cases,
the isolated cutover and all other gates passed. Conversation record/recovery
validation is now published after 88 actual SQL cases and all four CI gates.
Judge/reranker response boundaries are validated and published with all four
fresh CI gates. They do not activate a reranker or change a model/prompt.
The BE-14 migration-resource follow-up is also validated and published; the
actual image applied 31 migrations and repeated zero in a disposable database.
The BE-13 pilot and checked persisted replay are now validated and published.
The pilot has reviewed, versioned synthetic results and remains partial for
sustained load, pool/event-loop timing and multi-replica behavior.
BE-12 workflow diagnostic boundaries and BE-16 are also validated and published.
The owned-source/post-ingestion pilot and compiler diagnostics are also CI
validated and active. MCP quality-report stored rows are also CI validated and
published. The subsequent ingestion timeline, usage summary, MCP source/status
and full-job boundaries are also published in the combined receipt above.
Dependency/hosted-role decisions remain open.

## Completed explicit follow-up: BE-15

Feature module assembly is decoupled from PostgreSQL, LangGraph, LangSmith and
provider SDKs. It receives plain ports; outer composition selects the adapters.
Contract tests and dependency gates verify replacement boundaries.
See [ADR 0003](decisions/0003-technology-neutral-modules.md) and the technical
backlog for implementation/publication evidence. This follow-up was requested
after d045's organization delivery and is included in the newer source above.

## Implemented frontend slice: FE-06 administrative reads

Finite metadata/resource read deadlines and administrative polling ownership now
use the existing Query/API helpers. No package or API contract changed.

- Explicit ten-second resource read deadlines compose caller cancellation;
  provider-backed search, writes, originals and conversation transports retain
  their own limits.
- Document polling is removed. A control-center observer owns active ingestion
  polling and once-per-terminal-revision document/readiness invalidation.
- Errors and approval-only evaluations stop rapid timers. Focus/reconnect and
  manual retry remain available; visible owner usage keeps a 30-second refresh.
- Request-counter tests cover idle/active/failed states, filtered cache prefixes,
  deadline/disposal, offline/reconnect, usage unmount and zero duplicate effects.

Primary files: `widgets/workspace-control-center/model/queries.ts`, relevant
Knowledge/Processing/Evaluations observers, `entities/workspace/model/knowledge.ts`
and `usage.ts`, plus the shared API and focused UX tests. No new dependency.

## Implemented frontend slice: FE-06 conversations

The [conversation-reader record](operations/release-2026-11-07-conversation-readers.md)
records all four exact-source CI gates, both deployments and public checks.

- `RagLabPage` passes observation state while durable capability remains available.
  Ask observes messages, History observes names, and Search/admin do not poll an
  invisible conversation. Disposed reads consume abort signals.
- `use-conversation-messages` owns a finite recent-window query and explicit older
  page reads. `conversation-window` merges visited turns, validates scope/cursor/
  identities, fetches only unseen gaps and enforces deadline/page budgets.
- `use-live-answer` and `use-model-comparison` report reader ownership. SSE, HTTP
  fallback or comparison polling suppresses the competing recent-window reader;
  exhaustion hands reconciliation back to metadata without another admission.
- Forty-five focused checks passed across desktop/tablet/mobile, including 75
  visited turns, old feedback, unpinned scroll, abort/navigation, offline recovery,
  401/403/429, confirmed HTTP reload/read retries, exact admission counts and
  coalesced comparison Stop races. The
  seven-check local harness passed. Original baselines remain unchanged.

## Implemented frontend slice: FE-07

Native unions and correlated transitions now cover submission, delivery,
reconnection, cancellation and terminal outcomes. Nine type assertions reject
impossible states. Creation retries reuse the draft ID; navigation/selection
invalidates a late creation before it selects or admits a model execution.
Finishing an old run cannot settle a new one. Unconfirmed Stop retains the
execution, and a concurrent terminal response is reconciled with the Stop result.
Sending/Stopping states are visible and repeated Stop clicks coalesce.

Seventy-five focused checks passed across desktop/tablet/mobile, including all
FE-06 history/window guarantees. The seven-check local harness and 78 architecture
fixtures passed. See the [lifecycle record](operations/release-2026-11-07-chat-lifecycle.md).
**FE-07 is closed and published.** All four exact-source CI gates passed,
including 349 UX-suite cases/44 intentional profile skips, 83 PostgreSQL cases,
the isolated cutover, 78 architecture fixtures and seven harness checks. Both
Render deployments and served lifecycle assets were verified. **Next frontend
ticket FE-09** is now also complete and published. Continue with FE-10
measurements, then FE-11.
Broader promise/Hook tooling, least-privilege MCP credentials and the other
technical tickets retain their own acceptance criteria.

## Implemented backend slice: BE-08 native TypeScript checks

The read-only check at the previous source found exactly six diagnostics with
`--noUnusedLocals --noUnusedParameters`:

| File under `apps/api/src` | Remaining correction |
| --- | --- |
| `app/integration-tests/delivery-alerts.test.ts` | Rename the intentional unused mock parameter `input` to `_input` |
| `app/observability/telemetry.ts` | Remove unused `InvitationDeliveryError` import; current TS output already elides it |
| `modules/chat/application/conversations/delivery.ts` | Remove unused type `ConversationTurn` |
| `modules/evaluations/application/evaluation/assemble-report.ts` | Remove unused `dashboardPromptInjectionSuite` named import, retaining the used module import |
| `modules/mcp/infrastructure/remote.ts` | Remove unused type `McpPrincipal` |
| `modules/usage/infrastructure/postgres/pg-resilience-observability.integration.test.ts` | Remove unused type `WorkflowLease` |

All six are now resolved; the table preserves the original baseline. Both flags
are enabled in API TypeScript configuration and strict typechecking passes.
Unused type imports are erased, the remaining named module import is retained,
and the intentional mock argument is renamed. No lint dependency or formatting
migration was introduced. Promise/Hook correctness remains separate; these flags
do not complete BE-08/FE-08. Full validation is in the release record.

## Remaining work and study

The [technical backlog](technical-backlog.md) is authoritative for later contracts/
config/row decoding, least-privilege MCP credentials, dependency/build hygiene,
chat transitions, UI primitives, performance/capacity and forms/URL work.
The [product backlog](backlog.md) retains activation and optional infrastructure
items separately.

Do not install a tool or upgrade a library merely because a review lists a
candidate. The approved architecture checker is already included. The reviewed
Supabase SDK fix remains a separate decision in
[BE-14 evidence](operations/dependency-hygiene-2026-11-07.md).

When the owner starts the learning walkthrough, begin with the product journey
and trace one document/question before deeper modules. Save learning progress
separately from engineering completion, then resume these implementation tasks
without repeating completed work.

## Completed automatic continuation: FE-09

The owner authorized continuing the backlog while away. FE-09 centralizes action
state tokens, consolidates the remaining compatible native dialogs, and moves
source/evidence presentation into its entity Public API. No dependency was added.
The [primitive guide](frontend-primitives.md) and [release evidence](operations/release-2026-11-07-ui-primitives.md)
record implementation, CI and publication. The source above is live on both services.

Local validation passed 98 focused cases/10 intentional profile skips, plus 12
repeated popup/focus sequences. Exact-source CI passed 374 UX-suite cases/46
intentional skips, 83 PostgreSQL cases, the cutover, 78 architecture fixtures and
all seven harness checks. Health/protected routes and served semantic CSS were
verified. A PNG encoding variant required byte-specific browser proof of identical
rendered pixels; no screenshot tolerance was changed.

## Completed automatic continuation: FE-10

The measurement track is complete and published at the source above. See the
[performance guide](frontend-performance.md), versioned baselines and
[release evidence](operations/release-2026-11-07-frontend-performance.md).

Ninety focused cases and three native budget cases passed locally. The final CI
passed 389 UX-suite cases/46 deliberate profile skips, 83 PostgreSQL cases, the
cutover, 78 architecture fixtures, seven harness checks and the new payload gate.
Both deployments and public assets/health/protected routes were verified.

The controlled 75-turn workload decreased message reads from five to four, with
one admission and no competing status/resume reader. Timing is diagnostic lab
data; no field LCP or real-provider performance is claimed.

**Active next: FE-11**, focused native route and form-state normalization. The
inspection found separate popstate listeners, document filters held only locally,
and a chat draft cleared before conversation creation succeeds. Consolidate the
native adapter, allowlist safe URL metadata/conversation IDs, retain sensitive
text drafts locally, and preserve drafts on recoverable creation failure. Reuse
native forms/Zod; keep the new request/payload gates and FE-06/FE-07 race tests.
External activation, paid-provider load and learner outcomes remain separate.
