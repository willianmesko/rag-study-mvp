# Lumora

Lumora is a production-oriented, study-focused RAG application built with TypeScript,
PostgreSQL/pgvector, LangGraph, Supabase Auth, and interchangeable AI providers.
It keeps ingestion, retrieval, safety controls, and evaluation explicit so each
part of the system can be understood and measured.

> Lumora makes workspace knowledge easier to search, understand, and trust while
> keeping the path from document to chunk to embedding to grounded answer visible.

## Architecture at a glance

```text
Browser (React + TanStack Query)
          │ Supabase session token
          ▼
Fastify API (Clean Architecture + LangGraph)
          │
          ├── PostgreSQL + pgvector: documents, chunks, tenants, audit data
          ├── Supabase Storage: private original files
          ├── Ollama / OpenRouter / Bedrock: embeddings and answer generation
          └── Optional Jina: second-stage reranking
```

The detailed design is available in
[System Architecture](docs/system-architecture.md).

## Monorepo layout

```text
apps/
  api/                       Fastify API, migrations, workers, evaluations
  web/                       React + TypeScript frontend
packages/
  contracts/                 shared Zod schemas and inferred TypeScript types
docs/                        architecture, deploy guide, backlog
examples/                    versioned learning corpus
```

The shared contracts package prevents browser and API validation from drifting:
document ingestion, questions, search input, and workspace roles use the same
Zod schemas in both applications.

## Main capabilities

- Custom chunking with overlap and configurable embedding providers.
- Hybrid retrieval: pgvector cosine similarity + PostgreSQL full-text search,
  fused with Reciprocal Rank Fusion (RRF).
- Optional second-stage reranking.
- Grounded Q&A using a LangGraph workflow with source citations.
- Prompt-injection scanning before external reranking or answer generation.
- Private administrative ingestion for PDF, DOCX, TXT, and Markdown.
- Workspaces with `owner`, `editor`, and read-only `viewer` roles.
- Deterministic golden-set and prompt-injection evaluation suites.

## Prerequisites

- Node.js 22+ and Docker Desktop.
- PostgreSQL with pgvector, started through Docker Compose for local work.
- Ollama for the fully local path, or an OpenRouter key for the public demo.

## Local quick start

```bash
cp .env.example .env
docker compose up -d
npm ci
npm run db:migrate
```

For local AI, install the models once:

```bash
ollama pull nomic-embed-text
ollama pull llama3.2
```

Run the applications in separate terminals:

```bash
npm run dev:api
npm run dev:web
```

Open `http://localhost:5173`. The Vite development proxy forwards API requests
to `http://localhost:3000`, so no provider secret is exposed to the browser.

## Common commands

```bash
npm run dev:api           # start Fastify with file watching
npm run dev:web           # start the React application
npm run build             # build contracts, API, and web app
npm run typecheck         # type-check every workspace
npm test                  # run unit tests
npm run db:migrate        # apply API migrations
npm run eval:golden       # run the retrieval golden set
npm run eval:security     # run prompt-injection regression cases
```

## Providers

Ollama is the default local learning path. OpenRouter is useful for comparing
chat models without rewriting the adapter. Bedrock support is available for a
future AWS deployment. Use the same embedding model and dimension for ingestion
and querying; changing embedding models requires reindexing the corpus.

OpenRouter and Bedrock keys belong only in backend environment variables. Never
put a secret in a `VITE_` variable, because it becomes browser-visible code.

## Evaluation and safety

The API has a deterministic golden set for retrieval and a prompt-injection
suite for the document scanner. See [API evaluations](apps/api/evals/README.md)
for commands, quality gates, Promptfoo, and the Ragas integration path.

The prompt-injection classifier is a defense-in-depth signal, not a complete
security boundary. Retrieved text is treated as untrusted data and cannot grant
tools, change system instructions, or override authorization.

## Deployment

The public demonstration separates a static frontend, the API, and the
database. The current configuration uses Render for the API and static site,
Supabase for Postgres/Auth/Storage, and OpenRouter for hosted AI.

Follow [Public Demo Deployment](docs/deploy-public-demo.md) for the low-cost
deployment plan, environment variables, acceptance checks, and operating
constraints.
