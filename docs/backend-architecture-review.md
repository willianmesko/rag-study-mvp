# Backend architecture review

Reviewed on 2026-11-07 against `e25572d6118efbdb84190367a039526775fbd0b2`.
Implementation work is tracked in the [technical backlog](technical-backlog.md).
Findings below describe the audited baseline. Current implementation progress
and release evidence are tracked in the technical backlog; phase 1 now addresses
BE-01/02/04/05 and the idle-pool part of BE-03. The audit itself changed no
application code, dependencies, credentials, grants or hosting configuration.

## Decision

Keep the modular monolith: TypeScript, Fastify, Zod, PostgreSQL/pgvector,
Supabase Auth, LangGraph and explicit provider adapters. The useful next step is
stronger boundaries and targeted correctness fixes. The inspected evidence does
not justify NestJS, an IoC container, an ORM migration, another vector database,
Redis, or independently deployed services as a prerequisite.

Use native Fastify plugin encapsulation to divide HTTP responsibilities, typed
factories for composition, application ports for integrations, and the existing
repositories for parameterized SQL. Preserve transactions that enforce workflow
fencing, tenant isolation, quotas, index activation and idempotency.

This decision addresses maintainability at the current product stage. It does
not establish production throughput. The [capacity review](backend-scalability-review.md)
and its mixed-workload benchmark remain separate, measurable work.

## Inspection baseline

| Measure | Observed result |
| --- | --- |
| API TypeScript files | 175 production files and 67 test files |
| Production physical lines | 17,571, including comments and blank lines |
| Largest HTTP/composition modules | `interfaces/http/app.ts`: 993 lines; `bootstrap.ts`: 919 |
| Other large modules | `pg-workflow-repository.ts`: 580; `langgraph-rag-workflow.ts`: 528; `pg-ingestion-job-repository.ts`: 443; `pg-conversation-repository.ts`: 411 |
| Routes directly registered in `app.ts` | 41 registration statements; additional route modules exist |
| Application/domain imports into infrastructure/interfaces | None in the inspected relative static-import graph |
| Runtime dependency cycles | None in that graph |
| Type-level cycles | One pair: `application/mcp/read-tools.ts` and `hybrid-search.ts` |
| Explicit `any` in inspected production syntax | None; generic database defaults and assertions still need boundary review |
| Existing compiler | `strict: true`, ESM/NodeNext, ES2022 target |
| Additional compiler probe | Nine unused-symbol/parameter diagnostics: seven production and two test locations; existing configured checks still pass |
| Production dependency audit | Zero moderate/high/critical findings; two low findings from the Supabase Auth dependency chain |

The graph inspection used the installed TypeScript parser. It covers relative
static imports in API source, not all dynamic imports, package aliases or export
edges. These measurements are a dated inspection, not an automated architecture
gate or proof of absence of security defects.

The low advisory is [GHSA-8r88-6cj9-9fh5](https://github.com/advisories/GHSA-8r88-6cj9-9fh5)
in the installed Auth dependency chain. Audit detection is not evidence that
Lumora exposes the affected input path. Review reachability and a compatible fix
in BE-14; do not run an uncontrolled major dependency upgrade.

## Existing strengths

- Domain/application code already depends on ports rather than concrete HTTP,
  storage or model clients. Repository, Adapter, Strategy and Factory patterns
  are present; they do not need to be introduced as new generic frameworks.
- Membership and owner/editor/viewer roles are checked on the server. Client
  metadata does not select an arbitrary tenant or provider model.
- SQL binds parameters. Sensitive workflow results use authenticated encryption;
  completed effects, leases and quotas have durable database records.
- Provider work has cancellation/deadline and bounded execution policies.
  Ambiguous paid calls are distinguished from safely retryable rejections.
- The MCP reader already demonstrates read-only SQL, bounded transactions,
  scoped output, cancellation and current membership checks.
- Existing API, PostgreSQL, browser, golden-set, prompt-injection and Promptfoo
  suites provide substantial regression protection. The cutover gap below is
  specific; it does not mean the project has no integration tests.
- New outbox/invitation journals have private tables, safe audit metadata,
  idempotency and fenced completion. Native token/dollar measurements are kept
  separate from estimates and unknown prices.

## Concrete findings

### BE-01: Make key inventory stable under concurrent updates

**Priority P1, before reader-key retirement.**
`infrastructure/postgres/rotate-workflow-keys.ts:75-118` paginates physical
`ctid` across separate transactions. Workflow heartbeats and status updates
(`pg-workflow-repository.ts:206-240`) can move rows while retaining an old
ciphertext. A moving physical cursor can miss a logical row. The runbook
requires old encryption writers to stop, but status writers may still run.

Use immutable composite primary-key keysets for each allowlisted table, or
specify a fully quiesced/snapshot inventory protocol. Retain bounded batches,
lock/statement timeouts, authenticated decrypt/re-encrypt checks and conditional
updates. Test concurrent movement, a process restart and a full final inventory.
Do not retire reader keys based solely on the current physical-cursor report.
Live key rotation is not activated; no live retirement incident was observed.
[PostgreSQL system columns](https://www.postgresql.org/docs/current/ddl-system-columns.html)
explain why physical row location is not a durable logical identifier.

### BE-02: Preserve safe framework HTTP errors

**Priority P1, paired with FE-02.** The custom handler in
`interfaces/http/app.ts:227-249` preserves selected application errors and 429,
but turns Fastify parser/content-type errors into a generic 500. A local,
network-free `Fastify.inject` probe reproduced 500 for malformed JSON and an
unsupported XML body on `/v1/qa`.

Use one native Fastify-aware error mapper for trusted framework codes and small
stable application errors. Keep malformed JSON 400, unsupported type 415,
oversized body 413 and rate limit 429, while unknown exceptions remain sanitized 500.
Do not reflect arbitrary upstream `statusCode` or error text. Workspace creation
also maps every failure to 409 (`app.ts:418`); only a unique constraint such as
SQLSTATE 23505 supports the duplicate-slug interpretation. Preserve public error
contracts except for explicitly documented corrections of these defects.
[Fastify errors](https://fastify.dev/docs/latest/Reference/Errors/).

### BE-03: Handle pool faults and bound SQL work

**Priority P1 for the idle error listener; P2 for workload deadlines.**
`infrastructure/postgres/pool.ts:3-8` defines connection and idle timeouts, but no
idle-client `error` listener was found. Native `pg` forwards idle connection
errors to the pool; an unhandled event can terminate a Node process. The factory
also does not explicitly govern query/statement/lock execution deadlines.
Actual deployed connection-string/role defaults were not inspected.

Use `pool.on('error')` with fixed safe reason codes and pool health telemetry.
Apply workload-specific PostgreSQL execution limits and cleanup conventions;
reuse the MCP reader pattern (`pg-mcp-read-repository.ts:186-224`). Do not use one
short timeout for retrieval, indexing and migrations. Test idle disconnect,
`pg_sleep`, lock contention, caller cancellation and pool reuse after failure.
[Pool events](https://node-postgres.com/apis/pool),
[client timeout options](https://node-postgres.com/apis/client).

### BE-04: Recover budget intent over the complete accounting window

**Priority P1 before unattended webhook activation.** Ledger write and alert
enqueue are separate in `bootstrap.ts:113-121`. The repair scan only discovers
tenants active in the last day (`budget-alerts.ts:160-164`), while the threshold
uses 30 days (`:48-55`). A crash between commit and enqueue followed by 25 hours
of downtime can leave a qualifying alert undiscovered without another AI call.

Prefer atomic outbox intent with the ledger or a durable repair watermark.
A smaller first change can use bounded discovery over the complete threshold
window. Preserve the unique tenant/day/threshold identity and stable delivery ID.
Validate the crash gap, restart after 25 hours without new calls, pagination and
multiple repair workers. This is a recovery-window defect, not a demonstrated
lost production notification; a real webhook destination is not configured.

### BE-05: Gate embedding cutover with its actual integration suite

**Priority P1 before a live embedding migration.**
`pg-workspace-embedding-index.integration.test.ts:18,24-26` skips unless
`TEST_EMBEDDING_DATABASE_URL` points to disposable `/embedding_cutover_*`.
The workflow's PostgreSQL environment and command
(`.github/workflows/quality-gates.yml:29-42`) do not run this separate suite.

Use the existing runner and a separately created disposable database with Auth
fixtures and migrations. Require execution without skips; verify full rebuild,
tenant scope, dimensional checks, concurrent ingestion, cache invalidation and
rollback. Never redirect this destructive fixture to a live or shared database.

### BE-06: Extract bounded authentication and a scoped user directory

**Priority P2; use existing Supabase SDK.**
`app.ts:263-265,301-303,406-407,415-416` constructs clients and verifies sessions
inside HTTP orchestration without the bounded transport used by newer gateways.
Team listing (`:445-450`) fetches the first 1,000 global Auth accounts before
matching local membership IDs. Members outside that page may lose their email
label, and unrelated account records are unnecessarily fetched internally.

Introduce injected `SessionVerifier` and `UserDirectory` ports, separate public
and administrative clients, a deadline and one verified request principal.
Fetch authorized membership IDs first, then resolve only their directory records
with bounded concurrency or an explicit scoped projection. Preserve live SQL
membership/RBAC checks. No cross-tenant email response disclosure was demonstrated.

The installed Auth client has `getClaims`, but a change from `getUser` still
requires reviewing signing mode, verification, cache behavior and account/session
revocation expectations. Benchmark a JWKS-backed strategy only if those semantics
remain correct; retaining deadline-bounded `getUser` is a valid first step.
[Supabase claims verification](https://supabase.com/docs/reference/javascript/auth-getclaims).

### BE-07: Divide HTTP and composition responsibilities

**Priority P2, after boundary regression tests.** `app.ts` combines hooks, auth,
HTTP error policy, workspace/member integration, knowledge, uploads, cost,
evaluations and question routes. `bootstrap.ts` combines every adapter, model
factory, workflow definition and resource lifecycle. This makes changes touch a
broad dependency surface and drives assertion-heavy partial test dependencies.

Extract native Fastify route plugins by cohesive capability and give each a small
typed dependency interface. Reuse the existing separate conversation/MCP/action
route modules. Keep business policies in application code, vendor calls in
adapters and public wire contracts in `packages/contracts`. A budget-notification
port should replace HTTP dependency on the concrete `BudgetAlerts` class.
Split composition into typed feature factories, with one owned resource lifetime.

Do not split fenced transactions across generic repositories merely to lower a
line count. Move the MCP search/result interfaces to a neutral application
contract when touching that module; the existing type-only cycle is not a runtime
cycle. [Fastify encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/)
provides the framework mechanism without a new container library.

### BE-08: Add architecture and correctness checks incrementally

**Priority P2.** There is no configured lint/import architecture gate. Strict
compilation passes, but an additional unused-symbol probe found nine diagnostics,
including imports in `bootstrap.ts`, telemetry and HTTP/MCP code. There is no
reason to enable every strictness option at once or mass-format the repository.

Agree an explicit Node/tool baseline; evaluate typed ESLint correctness rules
and one graph gate. Enforce application/domain boundaries, runtime cycles and
public module boundaries with reviewed exceptions. Use `noUnusedLocals`,
`noUnusedParameters`, promise/error rules and consistent formatting in focused
changes. Evaluate `noUncheckedIndexedAccess`/exact optional properties module by
module. Keep domain ownership and testability as goals rather than line limits.

### BE-09: Enforce dedicated MCP database privileges

**Priority P2 before strong production least-privilege claims.**
`bootstrap.ts:147-149` allows `MCP_READ_DATABASE_URL` to fall back to the main
connection. Read-only transactions protect operations, but do not prove the
underlying credential has minimum privileges. No live credential was inspected.

Provision and verify a distinct read role, require the explicit connection in
production MCP mode, restrict allowed tables/columns and retain tenant filters
and current membership checks. Prove write/DDL/unapproved-read denial using that
role. Coordinate grants and a rollback path before enabling enforcement.

### BE-10: Price reranker reservations independently of the ledger

**Priority P2 before paid reranker activation.**
`workflow-provider-guards.ts:250-266` reserves 1,000 micros regardless of input or
configured pricing. Accurate measurement after a call does not itself enforce a
conservative pre-call budget.

Reserve from bounded request size and the approved independent reranker rate.
Reject an invocation that cannot fit remaining limits, classify native overrun
safely, and retain unknown-price distinctions. Test larger candidate sets,
non-default prices, retries and provider errors. No local guard can undo a charge
already incurred by a remote provider.

### BE-11: Bound shutdown and clarify supported worker modes

**Priority P2.** `server.ts:52-64` awaits ingestion before closing HTTP, has no
single-flight signal guard or overall drain deadline. The legacy ingestion path
in `process-next-ingestion-job.ts:24-61` lacks a parent shutdown signal.

Use one shutdown promise: stop admissions, signal active work, drain within a
budget and close resources in `finally`. Preserve recoverable workflow state,
provider cancellation and interrupted-versus-completed semantics. Test repeated
signals during provider/OCR/database waits. Extract a dedicated worker only when
the benchmark and hosting requirements justify it; first distinguish in-process
free-demo scheduling from always-running operational delivery.

### BE-12: Govern contracts, configuration and database decoding

**Priority P2, shared with FE-02.** Several route DTOs/serializers and validation
expressions are maintained separately from frontend equivalents. Global
`config.ts` parsing at import time and mutable fixture overrides couple tests and
adapter construction. Generic `pg` row defaults can hide unsafe assumptions even
without explicit `any` syntax.

Use shared Zod wire contracts, a small safe error taxonomy and explicit typed
module configuration. Decode externally influenced JSON/provider metadata at its
boundary; use typed database rows and checked missing-row handling. Keep wire
DTOs distinct from domain records when their semantics differ. Standardize
idempotency/workspace schemas without inventing a validation framework. An
OpenAPI export should derive from the agreed source rather than become a second
manually maintained truth.

**Implementation follow-up:** the typed configuration and two stored-row families now have a validated bounded increment. The [boundary guide](backend-configuration-and-records.md) and [release record](operations/release-2026-11-07-configuration-records.md) distinguish completed local checks from remaining provider/fixture/repository work and publication status. BE-12 remains partial.

### BE-13: Prove capacity and distributed fairness before scaling

**Priority P2 measurement; topology changes are conditional.** The pool cap is
per process and burst limiting is process-local; quotas and durable state are
shared. Tenants share vector indexes and database resources. These are valid demo
choices, not measured capacity guarantees.

Run the existing mixed-workload plan with synthetic tenant-skewed data and stub
providers first. Measure pool wait, locks, queue age, event-loop delay, query
plans, recall, first stream event and p95 latency/cost. Review trusted-proxy
identity and burst-limit behavior before multiple replicas. Use gateway/shared
rate limiting or a separate worker only in response to measured limits. Redis,
BullMQ and separate vector stores add operational cost; they remain alternatives.

### BE-14: Establish dependency and build hygiene

**Priority P2.** Review the two low audit findings in the Supabase chain through
a controlled compatible upgrade and the existing Auth/MCP/session suites.
Standardize the tested Node 24 development/build baseline against the broader
`>=20` manifest and any proposed tool's minimum version. Do not install tooling
that silently excludes documented development environments.

`apps/api/tsconfig.json` also compiles tests into runtime output. The Dockerfile
intentionally executes a native OCR smoke test from that output. Separate normal
test artifacts from the production build only while preserving that actual
Poppler/Tesseract image validation. Keep migration tracking, synthetic Auth
fixtures and optional/native test tiers explicit. Consider native GitHub
Dependabot/CodeQL tasks only after scoping their checks, privacy and CI cost;
automatic framework upgrades or auto-merge are not part of this audit.

## Proposed module map

This is a gradual ownership map, not a request to move 175 files in one change.

```text
src/
  domain/                         invariant/value policies
  application/
    ports/                        SessionVerifier, UserDirectory, repository capabilities
    use-cases/                    current behavior, moved only when a feature benefits
    workflows/                    application execution policies
  infrastructure/
    auth/                         bounded Supabase adapters
    postgres/                     SQL, fencing and transactions
    observability/                SDK exporters and delivery implementations
    openrouter/ bedrock/ ...       existing provider adapters
  interfaces/http/
    app.ts                        hooks and plugin registration
    errors.ts                     safe HTTP mapping
    security/                     request principal and authorization adapters
    routes/                       workspaces, knowledge, questions, evaluations, operations
  composition/                    small typed feature factories
  bootstrap.ts                    composition and resource ownership
```

## Library and pattern decisions

| Responsibility | Current/native first choice | Alternative and decision |
| --- | --- | --- |
| HTTP modularity | Fastify plugins/hooks and explicit typed dependencies | Keep Fastify; no new framework or IoC container justified. |
| Validation/contracts | Zod 4 and `packages/contracts` | Evaluate a Fastify/Zod type-provider/OpenAPI adapter only after response/error parity tests; avoid two manually maintained schemas. |
| Authentication | Existing Supabase SDK behind ports | Deadline-bounded getUser first; evaluate getClaims with explicit security semantics. No second identity framework. |
| Database | Parameterized `pg`, workload transactions and typed result boundaries | Prisma/Drizzle do not remove pgvector, fencing or transaction policy; no migration justified by this review. |
| Queues/outbox | Existing PostgreSQL leases, unique identities and effect journals | Dedicated worker first if needed; BullMQ/Redis or Temporal only for measured scheduling/scale requirements. |
| Retries | Native AbortSignal/timers and small effect-aware policy | Do not replace paid-call ambiguity with generic retry defaults. A circuit-breaker library needs an observed use case. |
| Logs/observability | Fastify/Pino serializers, reason codes and existing OpenTelemetry | Retain safe data policy; select a hosted backend separately rather than installing overlapping tracing products. |
| Tests | node:test, tsx, Fastify.inject, actual PostgreSQL and Playwright | No second backend runner needed. Close the specific contract/cutover gaps. |
| Static guarantees | Strict TS plus a reviewed ESLint/graph pilot | Share tooling decisions with the frontend; avoid several overlapping architecture plugins. |

## Delivery and verification

First ship behavior corrections independently: BE-01, BE-02 with the narrow
member-role transport part of FE-02, BE-03's pool handling, BE-04 and BE-05.
Then extract the Auth/directory boundaries, route plugins and composition without
changing endpoint/role semantics. Add graph/lint guards to keep that structure.
Finish workload measurement and only then choose expensive topology changes.

Every implementation ticket needs a focused regression, appropriate existing
API/PostgreSQL checks, affected browser journeys and release harness evidence.
Use synthetic accounts/corpora and no paid provider in normal CI. Preserve
private-data log policy and record before/after performance claims only when
measured. Do not bundle mass moves, formatting, dependency upgrades and behavior
changes into one pull request.

Relevant security guidance: [OWASP API resource consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)
for bounded work/cost and the existing isolation/SSRF/output-validation policies.
This is a code review and plan, not an OWASP certification or a penetration-test
claim. AWS/Terraform/GitLab expansion remains in the product backlog.
