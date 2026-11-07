# Backend module guide

Lumora is a TypeScript modular monolith. Business capabilities are grouped under
`apps/api/src/modules`, using feature-module organization inspired by NestJS and
the existing Fastify plugin/composition model. The application root wires the
providers explicitly. See [ADR 0002](decisions/0002-business-modules.md) for the
decision and trade-offs.

The organization delivery is live at `d045949`. The subsequent
[BE-15 decision](decisions/0003-technology-neutral-modules.md) separates module
assembly from technology selection. Factories now receive capability ports and
plain options; `app/composition` selects actual database, provider, workflow and
tracing adapters. Its validation and deployment status is tracked separately in
the [technical backlog](technical-backlog.md).

## Where to find a capability

| Module | Responsibility |
| --- | --- |
| `identity` | Session verification, bounded Supabase Auth access and member-directory lookup |
| `workspaces` | Workspace creation, memberships, roles, onboarding and invitations |
| `knowledge` | Document library, original-file access, passage storage, retrieval and demo libraries |
| `ingestion` | Upload admission, text extraction, OCR, language/structure enrichment and indexing jobs |
| `chat` | Grounded answers, model selection, conversations, feedback, streaming and semantic cache |
| `ai` | Provider ports/adapters, embedding versions, rerankers, prompt/output and cost guard policies |
| `evaluations` | Golden sets, injection checks, reviewed replays, judges and versioned reports |
| `mcp` | Scoped read tools, OAuth transport and the authorized-action boundary |
| `usage` | User/workspace quotas, usage ledger, administrative audit and budget deliveries |
| `workflows` | Authorized product execution and approval orchestration across capabilities |

```mermaid
flowchart TB
  Server[server.ts] --> App[app / composition and HTTP lifecycle]
  App --> Identity[Identity and Workspaces]
  App --> Knowledge[Knowledge and Ingestion]
  App --> Chat[Chat and AI]
  App --> Evaluation[Evaluations]
  App --> MCP[MCP]
  App --> Usage[Usage]
  App --> ProductWorkflows[Product Workflows]
  Identity --> Platform[Platform / SQL, transport, telemetry ports, security and durable execution]
  Knowledge --> Platform
  Chat --> Platform
  Evaluation --> Platform
  MCP --> Platform
  Usage --> Platform
  ProductWorkflows --> Platform
```

The diagram groups capabilities for orientation; it does not claim the modules
are independent microservices. They share the existing database and process.
Tenant authorization, SQL transaction/fencing rules and provider budgets remain
code-enforced boundaries within that deployment.

## Inside a module

```text
modules/ingestion/
  ingestion.module.ts
  ingestion.controller.ts
  index.ts
  application/
    ports/
    use-cases/
  infrastructure/
    extraction/
    langgraph/
    postgres/
```

- **Module factory:** assembles application use cases and policy using injected
  ports and plain feature options. It imports no database client, vendor SDK,
  concrete adapter or deployment configuration. It creates no pool or timer.
- **Controller:** a small Fastify adapter responsible for input validation,
  authorization and HTTP responses. It calls injected capabilities.
- **Application service/use case:** implements one operation using ports and
  policy. Existing use-case classes already provide this role.
- **Port:** defines the behavior needed from a repository, provider or service.
  Domain records and HTTP DTOs remain separate where their semantics differ.
- **Infrastructure:** PostgreSQL, Supabase, provider SDK, LangGraph or extraction
  adapters implementing those responsibilities.
- **Public API:** named contracts and capabilities exported from `index.ts` for
  other modules. Composition files and controllers stay outside that barrel.

Create only the folders a feature needs. Pure policy belongs beside its feature;
do not introduce a controller/service/repository trio for a trivial function.

## Shared platform and application root

`platform` owns reusable SQL deadlines/transactions, external HTTP transport,
correlation/event ports, redaction/risk primitives, generic durable execution,
workflow encryption, retry policy and bounded process shutdown. It must not load
business module implementations at runtime. The two reviewed type-only workspace
authorization contracts are checked as explicit edges.

`app` owns overall composition, the HTTP dependency facade, cross-cutting HTTP
hooks, exception mapping and telemetry transport that classifies product errors.
Application composition may bind concrete module adapters. Runtime resources have
one owner and repeated shutdown requests share one promise. See the
[shutdown runbook](operations/server-shutdown.md).

`server.ts`, operational commands under `interfaces/cli` and the restricted MCP
stdio launcher retain their existing entry paths. `config.ts` validates the
environment; SQL migration files stay under `apps/api/db/migrations`.

## Replace a tool at its boundary

```mermaid
flowchart LR
  Root[app/composition] --> Module[Chat / Knowledge / other module]
  Root --> Implementation[Selected adapter]
  Module --> Contract[Application port]
  Implementation -. implements .-> Contract
  Implementation --> Vendor[Model API / database / workflow engine]
```

The module uses the contract; only composition selects the implementation.
Examples in the current source:

| Concern | Contract | Current binding |
| --- | --- | --- |
| Generation and judging | `ModelProviderRegistry`, `AnswerGenerator`, `FaithfulnessJudge` | `app/composition/provider-registry.ts` |
| Embeddings | `EmbeddingProvider`, `WorkspaceEmbeddingIndexResolver` | Safe embedding decorator plus selected model adapter and PostgreSQL index resolver |
| Documents and membership | Feature repository ports | `app/composition/postgres-persistence.ts` |
| Original files and invitations | `OriginalFileStore`, `InvitationGateway` | `app/composition/supabase-bindings.ts` |
| RAG and durable chat | `QuestionAnsweringWorkflowFactory`, `ChatExecutionWorkflow` | `app/composition/chat-workflows.ts` |
| Tracing | `QuestionAnsweringWorkflowDecorator` | Optional LangSmith wrapping in that same outer binding |
| Ingestion and evaluation | Plain execution contracts with an explicit version | `app/composition/ingestion-workflow.ts` and `evaluation-workflow.ts` |
| Durable scheduling | `WorkflowEngine` | `app/composition/workflow-runtime.ts` |
| Budget notifications | `BudgetAlertService` | Current signed webhook/outbox adapter selected by persistence composition |

To switch among the supported chat providers, select the configured provider and
backend-owned model catalog. The business module still calls `createAnswer`.
To support another provider, implement its required capabilities, register them
in outer composition, and explicitly activate compatible configuration and public
model descriptors. The registry exposed to application code is read-only; browser
input cannot register a provider or supply arbitrary model identifiers.

To replace LangSmith, inject a workflow decorator that preserves result/error and
cancellation semantics, or the identity decorator when tracing is disabled. To
replace LangGraph, supply the workflow factory/execution ports and verify versions,
claim validation, budgets and cancellation. The in-memory replacement-adapter
tests exercise this without importing a graph or provider SDK into the core.

A database replacement needs repository implementations, migrated data and
equivalent tenant isolation, ordering, deduplication, transactions and fencing.
MCP action completion deliberately receives a same-client evaluation writer in
PostgreSQL composition: report insertion and action completion must commit or roll
back together. A generic SQL facade would conceal this requirement.

Compatibility remains explicit. Existing public provider descriptors and persisted
embedding provider constraints are retained. Embedding model/dimension changes
need a versioned reindex, dimension validation and semantic-cache invalidation.
Replacing the workflow engine requires a checkpoint/state migration or a safe
versioned transition. An interface alone cannot migrate stored state.

## Rules for changes

1. Start with the business module that owns the behavior.
2. Keep HTTP/vendor dependencies outside application/domain code.
3. Use another module's named public exports; use relative internal imports
   within a module. Inject the capability you need, rather than importing its
   composition factory from a service.
4. Keep shared HTTP schemas in `packages/contracts`. Decode external data before
   using it; folder boundaries do not validate an API response.
5. Preserve explicit workspace selection, fresh membership checks, quotas,
   durable IDs and atomic fenced transactions.
6. Add behavior-focused verification and update the
   [technical backlog](technical-backlog.md) with evidence.

```bash
npm run typecheck
npm run check:architecture
npm run test:architecture
npm test
npm run eval:harness
```

The [architecture gate](architecture-checks.md) checks frontend FSD, backend
module exports, inward dependencies and runtime cycles. PostgreSQL, responsive
browser tests and the Docker OCR smoke test remain separate release gates.
Passing dependency checks does not establish capacity or production scale;
mixed-workload measurement remains in the backlog.
