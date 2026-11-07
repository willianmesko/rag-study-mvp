# Backlog resume checkpoint

Recorded on **2026-11-07** after the owner requested resuming later from the same
point. The owner subsequently requested the specific BE-15 abstraction follow-up;
that follow-up is now validated and published. General backlog continuation remains
at the FE-06/BE-08 checkpoint below.

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

FE-06 and the next BE-08 slice were inspected, then stopped **before any edits**.
There is no half-implemented code, pending patch, new branch or library install
to recover. Resume from the source above plus any later documentation-only receipt.

## Completed explicit follow-up: BE-15

Feature module assembly is decoupled from PostgreSQL, LangGraph, LangSmith and
provider SDKs. It receives plain ports; outer composition selects the adapters.
Contract tests and dependency gates verify replacement boundaries.
See [ADR 0003](decisions/0003-technology-neutral-modules.md) and the technical
backlog for implementation/publication evidence. This follow-up was requested
after d045's organization delivery and is included in the newer source above.

## First frontend slice: FE-06 administrative reads

Current query cancellation is already mostly wired. Complete finite read
deadlines and polling ownership using the existing TanStack Query and API helpers.

1. Add explicit bounded metadata/resource reads in
   `apps/web/src/shared/api/rag-api.ts`. Classify each operation rather than
   inferring safety from GET: semantic search can call embedding/reranker providers.
   Keep mutations, SSE, original-file blobs and conversations out of this slice.
2. Remove perpetual five-second document polling. Poll ingestion jobs only while
   queued/processing and without a request error. Keep focus/reconnect behavior
   and cross-device reconciliation.
3. Give one workspace-scoped ingestion monitor responsibility for terminal
   revisions. Invalidate filtered/unfiltered document views and Ask readiness
   once when observed work becomes terminal, without duplicate mutations.
4. Stop rapid evaluation polling while settled, failed or only waiting for
   deliberate approval. Keep active runs/reference setup responsive.
5. Retain the intentional visible owner usage refresh and verify it stops after
   the section unmounts. Preserve scope keys and permission checks.
6. Use existing Playwright request counters/clock fixtures to prove active →
   terminal refresh, idle/error counts, deadlines, disposal, usage unmount and
   zero extra uploads/questions/provider effects. Test 401/403/429 and invalid data.

Primary files: `widgets/workspace-control-center/model/queries.ts`, relevant
Knowledge/Processing/Evaluations observers, `entities/workspace/model/knowledge.ts`
and `usage.ts`, plus the shared API and focused UX tests. No new dependency.

Later FE-06 work covers conversation observer visibility, one active-run transport
owner and newest-page refresh without reloading older messages. Keep durable
capability separate from whether a view is currently observed. FE-07 then addresses
explicit chat lifecycle transitions.

## First backend slice: BE-08 native TypeScript checks

The read-only check at the source above found exactly six diagnostics with
`--noUnusedLocals --noUnusedParameters`:

| File under `apps/api/src` | Remaining correction |
| --- | --- |
| `app/integration-tests/delivery-alerts.test.ts` | Rename the intentional unused mock parameter `input` to `_input` |
| `app/observability/telemetry.ts` | Remove unused `InvitationDeliveryError` import; current TS output already elides it |
| `modules/chat/application/conversations/delivery.ts` | Remove unused type `ConversationTurn` |
| `modules/evaluations/application/evaluation/assemble-report.ts` | Remove unused `dashboardPromptInjectionSuite` named import, retaining the used module import |
| `modules/mcp/infrastructure/remote.ts` | Remove unused type `McpPrincipal` |
| `modules/usage/infrastructure/postgres/pg-resilience-observability.integration.test.ts` | Remove unused type `WorkflowLease` |

Recheck the current source before editing. Preserve any required side effects,
run the native check, enable both flags in the API TypeScript configuration, then
run API typechecking and the unit suite. No lint dependency or generic formatting
migration is required for this slice. Promise/Hook lint coverage remains separate;
these two flags do not complete all of BE-08/FE-08.

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
