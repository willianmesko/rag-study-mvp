# Lumora

Lumora helps teams in any industry search their documents and ask questions
grounded in sources. A workspace can hold handbooks, procedures, FAQs, product
guides, project materials, or other knowledge its members are allowed to share.

The application is built with TypeScript, PostgreSQL/pgvector, LangGraph,
Supabase Auth, and interchangeable AI providers.
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
See [Durable workflows](docs/durable-workflows.md) for graphs, security boundaries,
local setup, budget semantics, recovery limits, and failure runbooks.

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
- Adaptive retrieval with one bounded rewrite/retry, source-grounded claim
  verification, and one citation/claim repair before a safe refusal.
- Encrypted native LangGraph checkpoints for private chat, ingestion, and
  evaluations, with owner approval, persistent budgets, and restart recovery.
- Structured grounded answers validated with Zod, citation allowlisting, and
  configurable agent step, timeout, token, and cost budgets.
- Prompt-injection scanning before external reranking or answer generation.
- Private administrative ingestion for PDF, DOCX, TXT, and Markdown, with OCR
  for scanned PDFs.
- Import public HTTPS pages and HTML files, detect Portuguese and English, and
  index passages using document headings or PDF page boundaries.
- Workspaces with `owner`, `editor`, and read-only `viewer` roles.
- Workspace control center with routed Overview, Knowledge, Processing, Team,
  Evaluations, and Settings sections plus a guided first-run onboarding path.
- Milo guide with bilingual fictional starter documents, role-aware invitation
  and upload actions, actual preparation status, a first grounded question,
  source inspection, and a Help entry that preserves completed setup.
- Reusable bilingual demonstration libraries, suggested questions with supporting
  sources, and workspace-scoped document, source, language, date, and type filters.
- Controlled model or prompt comparisons using shared evidence, recorded safety
  outcomes, and an export containing measurements rather than conversation text.
- Authenticated SSE chat with resumable progress, checked citations, and a stop
  action that cancels the provider request. The JSON endpoint remains available.
- Deterministic golden-set and prompt-injection evaluation suites.
- Workspace-scoped MCP read tools and a separate approval-gated evaluation worker.

See [Workspace MCP and approved actions](docs/workspace-mcp.md) for connection
setup, a worked example, budgets, and the execution boundaries.

## Prerequisites

- Node.js 24 and Docker Desktop.
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

### Scanned PDFs

In a signed-in workspace, upload a PDF in **Knowledge** and check **Processing**
for its OCR step. Lumora keeps the PDF's existing text and recognizes pages
without usable text in Portuguese and English. The timeline shows duration,
page counts, and estimated recognition confidence. OCR can misread accents and
small, blurry, or handwritten text. Review the original when accuracy matters.

The Docker API image includes Poppler and Tesseract and enables OCR by default.
For an API run directly on macOS, install them with
`brew install poppler tesseract tesseract-lang` and set
`PDF_OCR_ENABLED=true` in `.env`. Set `PDF_OCR_LANGUAGES=eng` if only
English language data is installed. The default budget is eight pages requiring
OCR and 45 seconds per recognition run. Split longer scans before uploading or
adjust the bounded settings documented in `.env.example`.

### Open an original upload

In **Workspace → Knowledge**, choose **Original file** on an indexed document.
PDFs can open in a new tab, and every available original can be downloaded.
Members can open files in their own workspace, including viewers. The API
checks membership, serves the original bytes with caching disabled, and records
the access in the audit trail. The action appears when the indexed revision is
linked to a retained upload.

### Import a public page or HTML file

In **Workspace → Knowledge**, an owner or editor can upload an `.html` or
`.htm` file or use **Import a web page**. A page import reads the HTML returned
by the site over HTTPS using a public IPv4 address. It accepts UTF-8 pages up
to 1 MB and limits the full download to 10 seconds and three redirects.

The worker extracts the main text, headings, title and description when
available, and identifies Portuguese, English, mixed, or undetermined text.
An explicit title takes precedence. HTML, Markdown, and Word headings guide
passage boundaries, while PDF extraction preserves page boundaries. The original
is available as a private download and processing appears in **Processing**.

### Review how an answer used your documents

In **Ask**, compare **Validated citations** with **Passages sent to the model**
to see which references appear in the answer and which passages helped draft it.
Cached answers show their saved passages. Cosine similarity runs from −1 to 1
and measures how closely a passage matches the question. Read the passage to
verify the facts behind an answer.

In **Processing**, owners and editors can request a sample of up to three
passages from the current indexed revision of a completed job. Search and
answer previews are limited to 600 characters after masking personal data
matched by the redaction rules. Search and processing previews hide passages
flagged as high risk.

### Work across multiple workspaces

Use **New workspace** next to the workspace selector to create another space
with the same account. You become its owner and start a separate setup guide.
The selector stays available during setup so you can return to an existing
workspace.

The selected workspace controls documents, search, chat, and permissions. The
same account can manage documents in one workspace and have read access in
another. Each Control Center section loads its own data.

Milo saves your selected goal and the furthest setup step for each workspace.
Sign in with the same account on another device to continue. If this browser
already had progress from an earlier release, Lumora syncs it when you return.

### Chat with Milo

In **Ask**, send a message and continue the conversation with a follow-up such
as “Does that apply to contractors too?” Milo uses up to three recent answered
questions from the active chat to resolve references, then searches the selected
workspace for fresh evidence. Expand the sources under each reply to review
the passages it cites. Press Enter to send or Shift+Enter to add a line.

The active thread stays open when you visit another section of the same
workspace. **New chat** clears the thread and its follow-up context. The
separate **History** view still keeps recent answered questions in this browser.
The public demo and side-by-side model comparisons handle each request on its own.

### Resume or stop a live answer

Signed-in chat resumes an interrupted connection in the same tab. The browser
keeps the run ID for that account and workspace. PostgreSQL keeps the ordered
events and answer for up to 24 hours, without storing the original question
in the replay tables. **Stop answer** cancels the run and aborts in-flight
provider requests. The public demo streams without storing a replay.

The chat shows progress while the model drafts. Lumora checks structured
citations before releasing the citations and answer text. A provider's ability
to stop upstream processing after an HTTP abort depends on its cancellation
support.

### Choose and compare chat models

Signed-in users can choose from their workspace's allowed models in Ask.
Owners set the list and default in **Workspace → Settings**. An optional Auto
policy picks a model by question complexity and can try approved fallbacks.
With two or more allowed models, **Compare two models** runs both over the same
retrieved passages and prompt version. **Compare prompts** works with one allowed
model: choose two backend-owned styles, Balanced, Concise, or Explanatory. A
comparison changes either the model or the prompt style, so evidence and the
other variable stay fixed. It uses two question-quota units and shows each
answer, checked citations, generation latency, tokens, estimated cost, and
validation outcome separately. Validated source identifiers do not establish
that every claim is factually correct.
Embeddings stay fixed until an explicit index migration. The public demo uses
the configured default chat model.

Operators can stage and switch workspace embeddings with `npm run embedding:index`.
See the [embedding index runbook](docs/workspace-embedding-index.md) for version,
dimension, coverage, activation, and rollback checks.

### Explore demonstration libraries and filter documents

In **Workspace → Knowledge → Demo libraries**, preview or download fictional
materials for team knowledge, support, or learning. Each library includes a
handbook, procedure, FAQ, product guide, project brief, and questions linked to
their supporting sources. An owner or editor can explicitly add a library to
the selected workspace. This uses normal upload quotas and the configured
embedding provider; choosing or previewing a library makes no AI calls.
Sources already present or being prepared are preserved. Questions become
available when their supporting documents are ready, and populate the chat
composer for review before sending.

**Advanced filters** search the selected workspace on the server before the
100-result limit. Combine a document, source text, language, file type, and
updated-date range. Dates include the whole UTC day.

The fixed retrieval benchmark requires a separate **RAG reference benchmark**
library. **Evaluations → Prepare reference benchmark** adds its reviewed
`golden/rag-fundamentals` source explicitly. This tests a known reference corpus;
the public faithfulness examples and judge calibration are separate measurements.
See [Demonstration and discovery](docs/demonstration-discovery.md) for the data
flow, contracts, and evaluation limits.

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
npm run eval:regression   # compare reviewed replays and screening metrics against the reference
npm run eval:performance-gate -- --baseline ... --candidate ... --limits ...
```

## Frontend quality checks

```bash
npx playwright install chromium
npm run test:ux
```

The suite exercises English and Brazilian Portuguese UI at desktop, tablet,
and mobile widths using fixture accounts and API responses. It checks viewport
overflow, hover and keyboard focus, disabled controls, member confirmation,
and onboarding across browser contexts. axe scans representative pages for
detectable accessibility and text-contrast issues.

CI compares screenshots with the references in `tests/ux/snapshots`. Run pixel
checks and regenerate references in the Linux x64 Playwright image pinned in
`.github/workflows/quality-gates.yml` to keep the browser and font rendering
consistent. Use `npm run test:ux -- --update-snapshots` there for intentional
visual changes. Review the diffs before committing updated references.

## Providers

Ollama is the default local learning path. OpenRouter is useful for comparing
chat models without rewriting the adapter. Bedrock support is available for a
future AWS deployment. Use the same embedding model and dimension for ingestion
and querying; changing embedding models requires reindexing the corpus.

OpenRouter and Bedrock keys belong only in backend environment variables. Never
put a secret in a `VITE_` variable, because it becomes browser-visible code.

## Evaluation and safety

The API has a deterministic golden set for retrieval, a prompt-injection
suite, and a versioned replay baseline for ranking and screening metrics.
Owners can evaluate context precision and optionally score public-fixture
faithfulness with a calibrated judge. See [API evaluations](apps/api/evals/README.md)
for methods, replay privacy rules, and the optional live Jina comparison.

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
