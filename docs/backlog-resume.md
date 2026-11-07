# Backlog resume checkpoint

Recorded on **2026-11-07** after the owner requested resuming later from the same
point. The owner subsequently requested the specific BE-15 abstraction follow-up;
that follow-up is now validated and published. General continuation has resumed
with the FE-06 administrative slice and BE-08 native TypeScript checks below.

## Current delivery

- Source: `cbd0f677baff2b415b16a785ea67bcbf48c99cc2`.
- [CI run](https://github.com/willianmesko/rag-study-mvp/actions/runs/42401306893).
- [Release evidence](operations/release-2026-11-07-capability-boundaries.md) records
  all four green CI jobs, both observed live deployments and production checks.
  A source push alone is not publication.
- Feature modules, response contracts, bounded identity/SQL, resource lifecycle,
  conservative reranking and FSD/module checks are in that delivery. Capability
  ports and outer adapter bindings now isolate the business factories from
  concrete database, model, graph and tracing implementations.
- [Learning walkthrough](learning-walkthrough.md): an 18-chapter plan is saved.
  The teaching sessions and learner outcomes remain pending.

The saved administrative and native TypeScript slices are now implemented.
Their [release record](operations/release-2026-11-07-query-ownership.md) tracks
validation/publication separately from the previous runtime above. No conversation
transport or pagination refactor has been bundled into the administrative slice.

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

**Next implementation slice:** conversation observer visibility, one active-run
transport owner and newest-page refresh without reloading older messages. Keep
durable capability separate from whether a view is currently observed. Verify
75 retained messages, scope disposal, terminal reconciliation and exactly one
explicit cancellation without resubmitting work. FE-07 then addresses explicit
chat lifecycle transitions. FE-06 remains partially complete until these pass.

The next read-only inspection has identified concrete starting points:

- `pages/rag-lab/ui/RagLabPage.tsx` keeps `useConversation` mounted while the
  selected tab changes. Pass explicit observation state; do not reuse durable
  capability as a visibility flag or route work through a stateless fallback.
- `features/question-answering/model/use-saved-conversations.ts` currently polls
  an infinite message query every two/fifteen seconds. Its refetch revisits loaded
  older pages. Preserve cursor/order and already loaded turns while refreshing
  only the newest window; handle window overlap and newly arrived messages.
- The same model can overlap the SSE reader in `use-live-answer.ts` or the saved
  comparison reader in `use-model-comparison.ts` / `api.waitForSavedTurn`. Pick one
  active execution reader, including disconnected/recovery states. Metadata
  reconciliation and explicit execution cancellation are different operations.
- Add request counters for 75 loaded messages, tab changes, scope disposal,
  offline recovery, completion and one explicit Stop. Preserve message feedback,
  idempotent IDs, reconnect cursors and older-page scroll position. Do not broaden
  this into the separate FE-07 state-machine increment without its acceptance tests.

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
