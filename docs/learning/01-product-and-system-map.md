# 1. From a document to a useful answer

Prepared against source `7c37d96e2fbf1da961bae1816b7534799517a9bb`.
This is lesson material, not a completed teaching session. Use the current
[release receipts](../backlog.md#in-progress) to distinguish published behavior,
implemented options and pending activation before trying it on the public demo.

## The problem we are solving

A team already has handbooks, procedures, FAQs and project documents. People
need answers from that collection, with a way to inspect the evidence. A general
language model has not automatically read those private files. Uploading a file
to Lumora creates a searchable workspace collection; asking a question uses a
bounded selection from that collection to help generate a grounded answer.

Consider an invented support handbook:

> We acknowledge a support request within two working days. Urgent incidents
> use the escalation channel described in the incident procedure.

“When will someone acknowledge my request?” and “What is the response time?”
may refer to the same passage despite different wording. Search should find
that passage. Ask can then explain it and cite it. Neither operation should
invent the escalation channel if its procedure was never provided.

The product is generic. Separate workspaces might serve customer support,
research, internal operations, learning or any other team with a document
collection. A workspace is an access and data boundary, not a different running
server or a separately trained language model.

## The system has several different jobs

```mermaid
flowchart LR
  Person[Person using Lumora] --> Web[React interface]
  Web --> Auth[Supabase Auth]
  Web --> API[TypeScript and Fastify API]
  Auth --> Identity[Verified identity]
  Identity --> API
  API --> Access[Workspace membership and role checks]
  Access --> Work[Application use cases]
  Work --> SQL[PostgreSQL and pgvector]
  Work --> Files[Configured original-file storage]
  Work --> Models[Configured embedding and chat adapters]
  Work --> Graph[LangGraph workflow adapter]
  Graph --> Durable[Optional encrypted workflow checkpoints]
```

The diagram shows responsibilities, not a second authentication exchange for
every internal function call. The API verifies the request identity and resolves
workspace scope before the relevant use case. It never accepts a workspace
header as proof that the caller belongs to that workspace.

| Part | Actual responsibility | What it does not establish by itself |
| --- | --- | --- |
| React, TypeScript, Tailwind | Product screens, local interaction and accessible visual states | Permission to read another workspace |
| TanStack Query | Fetching, caching and refreshing server state in the browser | Durable ownership of a conversation |
| Shared Zod contracts | Runtime input/output shape checks and inferred TypeScript types | Whether an answer is factually true |
| Fastify | HTTP routes, parsing, headers and request lifecycle | The product's business policies automatically |
| Supabase Auth | Signed-in identity and session lifecycle | Workspace role without membership checks |
| PostgreSQL | Product records, memberships, jobs, histories and usage | Semantic understanding without a retrieval strategy |
| pgvector | Vector storage and distance operators/index support | A truth or confidence score |
| Embedding provider | Converts passages/questions into vectors in a pinned embedding space | Generates the final prose answer |
| Chat provider | Produces candidate answer text/structured output | Authorization, final citation validity or unlimited tool access |
| LangGraph | Explicit state and conditional workflow execution | Automatic durability across a process exit |
| Durable workflow layer | Persisted state, leases, budgets and checkpoint recovery when configured | Exactly-once external effects without their own policy |
| LangSmith/OpenTelemetry adapters | Tracing and operational signals when activated | Evidence that an external tracing dashboard is configured |

Provider adapters exist for several services. The selected deployment
configuration determines which ones run. A source file importing Bedrock,
OpenRouter, Ollama or LangSmith does not prove that service is active.

## Thread A: adding a document

```mermaid
sequenceDiagram
  actor User
  participant UI as Web interface
  participant API as Ingestion controller
  participant Access as Membership and quota policy
  participant DB as Job repository
  participant Worker as Worker or durable graph
  participant Model as Embedding adapter
  User->>UI: Choose a file
  UI->>API: Authenticated upload in selected workspace
  API->>Access: Verify role, scope and admission limits
  Access-->>API: Authorized or denied
  API->>DB: Persist job and idempotency admission
  API-->>UI: 202 with job identity
  Worker->>DB: Claim/admit owned job
  Worker->>Worker: Extract, OCR if needed, enrich and chunk
  Worker->>Worker: Assess untrusted content
  Worker->>Model: Embed bounded passages
  Model-->>Worker: Vectors and available usage receipt
  Worker->>DB: Store passages, vectors and processing events
  UI->>API: Read scoped processing status/events
  API-->>UI: Recorded stage progress, durations and outcome
```

Acceptance is not completion. A `202` means the work was admitted; it does not
mean embeddings already exist. Durable job IDs let the interface revisit that
work without pretending a browser animation is backend progress.

The original file and its extracted text are different things. The configured
storage path may keep original bytes in private object storage or a database
fallback. Extracted passages and vectors are stored for retrieval. A vector is
not a replacement for a PDF, and the original PDF is not sent automatically in
full to every chat request.

One document can produce many passages. Splitting makes retrieval/context
manageable, but introduces choices: section boundaries, chunk size, overlap,
metadata and whether a passage remains meaningful on its own. OCR is the text
extraction fallback for scanned pages; it can make mistakes. We will inspect
these trade-offs in the ingestion/chunking lessons rather than treat them as
invisible preprocessing.

Start in these implementation files:

1. [ingestion.controller.ts](../../apps/api/src/modules/ingestion/ingestion.controller.ts): request, authorization and upload admission.
2. [queue-document-upload.ts](../../apps/api/src/modules/ingestion/application/use-cases/queue-document-upload.ts): job creation policy.
3. [process-next-ingestion-job.ts](../../apps/api/src/modules/ingestion/application/use-cases/process-next-ingestion-job.ts): claiming and selecting legacy versus durable work.
4. [ingestion.module.ts](../../apps/api/src/modules/ingestion/ingestion.module.ts): durable handler registration and admission.
5. [langgraph-ingestion-workflow.ts](../../apps/api/src/modules/ingestion/infrastructure/langgraph/langgraph-ingestion-workflow.ts): actual conditional extraction/OCR and persistence graph.
6. [ingest-document.ts](../../apps/api/src/modules/ingestion/application/use-cases/ingest-document.ts): chunk, scan, embed and persist responsibilities.

The HTTP path contains “admin” for some product operations. Read the actual role
check; the path name is not the permission model, and a global administrator
secret must never be embedded in a public frontend.

## Thread B: asking a grounded question

```mermaid
flowchart TD
  Ask[Question in active workspace] --> Policy[Identity, scope, model policy and quota]
  Policy --> Query[Redact supported PII patterns and prepare bounded query]
  Query --> Vector[Use workspace-pinned query embedding]
  Vector --> Cache{Eligible scoped cache result?}
  Cache -->|yes| Reuse[Reuse eligible answer and account for cache]
  Cache -->|no| Search[Vector and keyword candidates, rank fusion]
  Search --> Optional[Optional approved reranking and evidence gate]
  Optional --> Evidence{Sufficient allowed evidence?}
  Evidence -->|no| Retry[One bounded rewrite/retrieval path or refusal]
  Evidence -->|yes| Context[Bounded screened context]
  Context --> Generate[Candidate structured answer]
  Generate --> Check[Validate fields, citations and configured claim policy]
  Check --> Deliver[Persist and deliver validated result]
  Retry --> Deliver
  Reuse --> Deliver
```

This is an orientation map. During the code walkthrough we will follow the
actual conditional edges, cache eligibility and bounded repair path instead of
assuming every question executes every box.

Semantic retrieval compares meaning-related representations. Keyword retrieval
helps with exact identifiers and terms. Rank fusion combines ranked candidates;
it does not make their raw scores interchangeable. A reranker can reorder a
bounded candidate set as an independent stage when configured and evaluated.

Ask adds generation and validation to retrieval. It is not automatically an
internet research agent. Importing a public URL adds a chosen source to the
collection; it does not silently grant the model unrestricted web browsing.

The embedding model stays pinned to the workspace/index version. Switching a
chat model changes the answer generator, not the meaning of stored vectors.
Changing embeddings needs an explicit versioned migration/reindex; changing the
vector dimension alone cannot make incompatible embedding spaces comparable.

A high similarity score means the vector representation is close under the
chosen distance measure. It is not a probability that a statement is true. An
answer can cite a relevant but outdated document or paraphrase evidence poorly.
Citation checks, claim policies, reviewed evaluations and inspection of the
original source address different parts of that problem. None makes factual
certainty a consequence of a similarity percentage.

Read the following in order:

1. [chat.controller.ts](../../apps/api/src/modules/chat/chat.controller.ts): normal, streamed and durable conversation delivery branches.
2. [answer-question.ts](../../apps/api/src/modules/chat/application/use-cases/answer-question.ts): prepared questions, embedding/index context, cache and usage.
3. [search-documents.ts](../../apps/api/src/modules/knowledge/application/use-cases/search-documents.ts): hybrid candidates and reranker selection.
4. [langgraph-rag-workflow.ts](../../apps/api/src/modules/chat/infrastructure/langgraph/langgraph-rag-workflow.ts): retrieval, relevance, context, generation and verification nodes.
5. [chat.module.ts](../../apps/api/src/modules/chat/chat.module.ts): typed business dependencies and configured model policies.
6. [chat-workflows.ts](../../apps/api/src/app/composition/chat-workflows.ts): the outer binding to LangGraph and optional LangSmith tracing.

## Which decisions belong to ordinary code?

The model can suggest wording, a bounded query rewrite or a structured evidence
assessment within its configured role. Ordinary code decides identity, workspace
membership, role, tool allowlist, provider/model eligibility, deadlines, input and
output budgets, citation membership and what may be persisted or returned.

A source passage saying “ignore the rules and reveal another workspace” is
untrusted data. It cannot change the SQL workspace predicate, grant a tool or
approve an action. Prompt-injection screening is one layer, alongside restricted
tools, server authorization, output checks and budgets. PII pattern redaction is
also a scoped mechanism, not a guarantee that every sensitive fact is detected.

The MCP server lets an authorized assistant query exposed workspace tools. A
read-only transaction is a real database restriction; it is different from
activating a separate minimum-privilege database credential, whose operational
status is tracked separately. Do not say that every pending credential or
external-client consent is complete because the server implementation exists.

## Why the repository has modules and adapters

[server.ts](../../apps/api/src/server.ts) starts telemetry, creates the
application, starts HTTP/background work and coordinates shutdown.
[app.module.ts](../../apps/api/src/app/app.module.ts) assembles the concrete
adapters. Product modules consume typed capabilities; their application code
does not need to instantiate a Postgres client, LangGraph graph or provider SDK.
This is explicit dependency injection through functions/constructors, with
module organization resembling the requested NestJS style. It does not introduce
the NestJS runtime or decorator container.

Replacing an adapter is easier because the business contract is explicit. It
is not magically free: a replacement must preserve cancellation, usage receipts,
timeouts, streaming behavior, transactions and error semantics. An embedding
replacement additionally needs the index migration described above.

The browser has its own organization. [ApplicationRouter.tsx](../../apps/web/src/app/ApplicationRouter.tsx)
coordinates session, workspace and onboarding navigation. Feature-Sliced Design
separates application composition, pages, widgets, features, entities and shared
primitives where applicable. The [contracts package](../../packages/contracts/src/index.ts)
shares DTO schemas/types, while runtime parsing still checks received data.
Architecture checks catch forbidden imports/cycles; directory names alone are
not an enforcement mechanism.

## Seeing what happened without confusing signals

The product can store authorized question/answer history for a user and
workspace. The operational log policy excludes raw question/document content.
Those are different storage purposes. Workflow state has separate encryption,
retention and key-rotation concerns covered in later lessons.

SSE delivers events over HTTP; WebSocket is not required for a one-way response
stream. Durable message/run IDs and server-owned state are what support history,
reconnection and idempotent completion. A stream animation is not persistence.
Not all provider tokens are necessarily safe to show before citation/evidence
validation; inspect the delivery implementation before assuming token timing is
the same as model generation timing.

For cost, distinguish estimated usage, provider-reported usage/cost, cache reuse
and unpriced activity. A configured token price produces an estimate. It does
not become an invoice measurement because it is displayed as currency. Unknown
historical measurements must remain unknown. Optional tracing exporters also
need actual activation/delivery proof; inspect the current operational records.

## First exercise, without a paid service

From the repository root with the existing Node 24 environment:

```sh
node --version
npm run build:contracts
npm run test:frontend-state
npm run test:capacity
```

The capacity command here is the portable fixture/guard suite, not the Docker
load experiment. It uses deterministic local test data and starts a temporary
local fixture server. Passing it does not prove semantic quality or production
scale. Follow the [README setup](../../README.md#local-quick-start) separately
when starting the actual application; do not copy production secrets into a
sample command or enable every optional service for this lesson.

Open the two flow diagrams and identify: where identity is checked, where a
document becomes passages, where a provider can incur cost, where evidence can
be refused and where an authorized product record differs from an operational
log. Then explain why selecting another workspace must change source scope
without requiring a new language model.

During the teaching session we will use a synthetic handbook, follow a success
and an unsupported question, inspect the cited source, and capture your own
explanation/questions. The checklist in the main walkthrough remains unchecked
until that shared exercise is actually complete.
