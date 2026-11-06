# System Architecture

## Purpose

RAG Study Lab is a learning-oriented implementation of a production-style
retrieval-augmented generation system. It demonstrates how a document becomes
retrievable context and how that context is used safely to produce an answer.
The system is deliberately explicit: retrieval, ranking, security checks, and
provider adapters can each be inspected and replaced independently.

## System boundaries

```mermaid
flowchart LR
  U[User] --> W[React web application]
  W -->|Supabase access token| A[Fastify API]
  A --> P[(PostgreSQL + pgvector)]
  A --> S[Supabase private Storage]
  A --> E[Embedding provider]
  A --> L[Chat provider]
  A -. optional .-> R[Reranker]

  subgraph Providers
    E
    L
    R
  end
```

The browser is an untrusted client. It receives only public configuration,
short-lived Supabase sessions, answers, and sources permitted by the API. It
never receives database credentials, provider keys, a service-role key, or an
administrative API key.

## Frontend information architecture

The private workspace is a routed control center rather than one long
administration screen:

```text
/workspace/overview       → workspace pulse and next actions
/workspace/knowledge      → sources, upload, filters, chunks, reindex/delete
/workspace/processing     → ingestion timeline, retries, and stage errors
/workspace/team           → invitations, members, and roles (owner)
/workspace/evaluations    → golden-set quality and safety runs (owner)
/workspace/settings       → workspace identity, usage, and policies (owner)
```

The workspace selector remains in the global header. Each section enables only
the queries it needs so a failed members or evaluation request cannot blank the
whole workspace. The onboarding guide is workspace-scoped, explains concepts
in plain language, and links directly to the next action.

## Monorepo and ownership

```text
apps/web                 React feature-sliced UI and browser-safe API client
apps/api                 HTTP boundary, use cases, infrastructure adapters, CLI
packages/contracts       Zod schemas shared between web and API
```

`packages/contracts` owns request-shape validation shared across application
boundaries. The API still owns authorization and every server-side invariant.
Type sharing does not make the browser a trusted source.

## API architecture

The API follows Clean Architecture. Dependencies point inward.

```mermaid
flowchart TB
  H[HTTP and CLI interfaces] --> UC[Application use cases]
  UC --> D[Domain policies and entities]
  UC --> Ports[Ports]
  I[Infrastructure adapters] --> Ports
  B[bootstrap.ts] --> H
  B --> I
```

- **Domain** contains chunk, document, and prompt-injection rules without HTTP,
  database, or provider SDK dependencies.
- **Application** implements use cases such as ingesting a document, searching,
  answering a question, queueing uploads, and managing members.
- **Ports** describe capabilities such as embedding, retrieval, file storage,
  quotas, audit events, and answer generation.
- **Infrastructure** adapts PostgreSQL/pgvector, Supabase Storage, Ollama,
  OpenRouter, Bedrock, Jina, LangGraph, and LangSmith to those ports.
- **Interfaces** translate HTTP and CLI input into application calls.
- **Bootstrap** selects concrete adapters from environment configuration.

This separation allows a model provider to be changed without rewriting a use
case, and enables deterministic fakes in tests.

## Ingestion flow

```mermaid
sequenceDiagram
  participant Admin
  participant Web
  participant API
  participant Store as Private Storage
  participant DB as Postgres
  participant Model as Embedding provider

  Admin->>Web: Select PDF, DOCX, TXT, or Markdown
  Web->>API: Authenticated upload with workspace header
  API->>DB: Create durable ingestion job
  API->>Store: Persist original when configured
  API->>DB: Record queued event (no document content)
  API->>DB: Claim job
  API->>DB: Record source-read and extraction timings
  API->>API: Extract text, normalize, chunk, scan injection signals
  API->>Model: Embed safe chunks
  API->>DB: Replace document chunks in a transaction
  API->>DB: Record chunk, embedding, and persistence counts/timings
  API->>DB: Mark job completed with progress metadata
  Web->>API: Poll job, timeline, and document state
```

Chunking limits the amount of text sent to an embedding model and creates
retrieval units. A small overlap preserves ideas spanning chunk boundaries.
Chunk size and overlap are quality and cost trade-offs, not universal constants.

The same source can be re-ingested. Embeddings are generated before the storage
transaction so a provider failure cannot erase the last indexed document.

The ingestion timeline stores operational facts only: stage, status, timestamp,
duration, and safe numeric counts such as characters, chunks, or vectors. The
document text and original file remain outside the event stream.

## Retrieval and answer flow

```mermaid
flowchart LR
  Q[Question] --> V[Query embedding]
  Q --> K[Postgres full-text search]
  V --> S[pgvector cosine similarity]
  S --> F[RRF fusion]
  K --> F
  F --> G[Prompt-injection filter]
  G --> RR{Reranker enabled?}
  RR -->|yes| R[Top candidates reranked]
  RR -->|no| C[Top-K context]
  R --> C
  C --> LG[LangGraph workflow]
  LG --> A[Structured grounded answer + sources]
```

Hybrid retrieval combines two complementary signals:

- Vector search handles semantic similarity, including paraphrases.
- Full-text search handles exact terms, identifiers, and rare vocabulary.
- Reciprocal Rank Fusion merges rank positions without assuming scores from the
  two retrieval methods are comparable.
- An optional reranker reads a limited set of candidates and improves ordering
  before the LLM receives the final context.

The displayed retrieval score is a relative relevance signal, not a probability
or a guarantee that an answer is correct. The UI exposes sources so users can
inspect the evidence.

## Streaming answer flow

```mermaid
sequenceDiagram
  participant Browser
  participant API
  participant Workflow as LangGraph
  participant Provider

  Browser->>API: POST /v1/qa/stream (session + workspace)
  API-->>Browser: accepted
  API->>Workflow: retrieve with tenant scope
  Workflow-->>Browser: retrieving
  Workflow->>Provider: stream grounded generation
  Workflow-->>Browser: generating + token deltas
  Workflow-->>Browser: validating
  API-->>Browser: completed answer + validated citations
  Browser->>API: AbortController on user cancel
```

The first streaming transport is authenticated Server-Sent Events (SSE), which
fits the dominant server-to-browser flow and preserves the existing structured
answer contract. The regular JSON endpoint remains a fallback. WebSocket is
reserved for future bidirectional requirements such as presence, live approval,
or collaborative sessions.

## LangGraph workflow

The Q&A workflow has three main nodes:

1. `retrieve`: execute tenant-scoped hybrid retrieval.
2. `prepare_context`: remove high-risk chunks and wrap remaining material as
   untrusted reference text.
3. `generate_answer`: ask the selected chat provider for a grounded answer and
   validate its structured output before returning allowed citations.

When the strongest retrieved result is below the configured minimum score, the
workflow refuses rather than inventing an answer.

## Security model

| Risk | Control |
| --- | --- |
| Prompt injection inside documents | Deterministic scanner, untrusted-context delimiters, high-risk chunk exclusion |
| Cross-workspace access | Tenant ID derived from validated membership, mandatory repository filtering |
| Unauthorized writes | Supabase session verification plus `owner`/`editor` role checks |
| Browser secret leakage | Provider, database, service-role, and admin keys remain server-only |
| Cost abuse | Tenant question quota, administrator upload-byte quota, compact audit trail |
| Unsafe LLM output | Zod contracts and server-side citation validation |

The scanner is not a complete defense. It reduces exposure and provides a testable
signal; authorization, least privilege, safe tool policies, and evaluation are
separate controls.

## Identity and tenancy

Supabase Auth authenticates administrators. The API validates each bearer token,
then resolves a membership from `tenant_memberships`. The requested workspace
header is accepted only when it is one of the caller's memberships.

- **owner**: manage members, invite users, create workspaces, and manage corpus.
- **editor**: manage the workspace corpus.
- **viewer**: read documents and chunks only.

All document, chunk, job, quota, and audit operations are tenant-scoped. The
frontend stores a selected workspace only as a convenience; it never establishes
authorization on its own.

## Evaluation and observability

The repository contains three complementary quality layers:

1. **Unit tests** for domain logic and use cases.
2. **Golden set** for deterministic retrieval regression metrics such as hit rate
   and MRR.
3. **Prompt-injection suite and Promptfoo** for security regression coverage.

LangSmith tracing is optional and disabled by default. It should be enabled only
after deciding what content and metadata may leave the system. A future
production deployment can use LangSmith or an OpenTelemetry-compatible platform,
not both by default.

### What Promptfoo does

Promptfoo is a test runner for LLM prompts and providers. It executes a matrix of
inputs, sends them to a configured provider, evaluates assertions, and returns a
non-zero exit code when a case regresses. This repository uses a local provider
that calls the deterministic prompt-injection scanner, so the default CI check
does not transmit document text, prompts, or secrets to a hosted model.

### Structured output and Zod status

Request validation is fully shared through `packages/contracts`, but generated
answers were previously free text. The LangGraph boundary now asks providers for
a JSON answer with `answer`, `citedChunkIds`, and `refusalReason`, parses it with
Zod, and rejects citations that do not belong to retrieved chunks. Plain-text
local models remain supported as a compatibility fallback and are marked as
unstructured; a stricter production setting can reject that fallback.

### Agent safety boundary

The current workflow is still a bounded RAG agent rather than a general-purpose
tool-using agent. Its safety policy is explicit:

| Model may decide | Code must enforce |
| --- | --- |
| How to phrase a grounded answer | Tenant scope and RBAC |
| Which retrieved evidence is relevant | Prompt-injection filtering |
| Whether to express uncertainty | Citation allowlist |
| Whether a refusal is appropriate | Step, token, time, and cost budgets |

Read-only workspace tools are defined as an allowlist, but no write-capable tool
is exposed yet. Actions that mutate data, contact external systems, or execute
code will require an approval checkpoint before they are added.

## Deployment profile

The economical demonstration profile is:

```text
Render static site  →  Render API  →  Supabase Postgres/Storage/Auth
                                       ↘ OpenRouter when hosted models are needed
```

The frontend publishes `apps/web/dist`; the API builds from the repository root
with `apps/api/Dockerfile`. Configuration is supplied by the hosting platform,
not committed files. The deployment guide lists the required variables and
acceptance checks. Supabase RLS policies allow authenticated workspace reads by
membership, while cache, quota, audit, and usage tables remain backend-only.

## Next architectural increments

1. Capture provider-native token usage where available.
2. Add OCR, URL ingestion, language detection, and structure-aware chunking.
3. Move large ingestion workloads to a dedicated queue worker when required.
