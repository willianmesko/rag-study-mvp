# Public Demo Deployment

This configuration deploys a low-cost demonstration, not a commercial
production service. Free plans can sleep, restart, and enforce usage limits.
The objective is to demonstrate the RAG workflow without exposing ingestion,
provider credentials, or database access to the public browser.

## Deployment topology

```text
Static site on Render
        │ HTTPS + restricted CORS
        ▼
Fastify API on Render
        ├── Supabase Postgres + pgvector
        ├── Supabase Auth and private Storage
        └── OpenRouter (chat and/or embeddings)
```

## 1. Supabase

1. Create a Supabase project and enable the `vector` extension.
2. Copy the direct connection string to `DATABASE_URL` in the API service.
3. Apply migrations from a trusted local environment:

   ```bash
   DATABASE_URL='postgresql://...' npm run db:migrate
   ```

4. Create a private bucket called `rag-originals` if administrative uploads are
   enabled. If the bucket has a content-type allowlist, include
   `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
   `text/plain`, `text/markdown`, and `text/html`. URL imports save the
   downloaded page as HTML before queueing ingestion. Set the bucket size
   limit to cover the API upload limit. Never expose the service-role key to
   the frontend.

Apply `016_chat_runs.sql` before releasing the resumable chat API. This adds
server-only replay tables. Confirm both tables have RLS enabled and that
`anon` and `authenticated` have no direct table grants before deploying the web
client. Deploy the API before the web client and retain the tables during a
code rollback so existing runs can still expire normally after recovery.

Apply `017_workspace_onboarding.sql` before releasing synced Milo onboarding.
The new table is restricted to the API and stores one progress record per
workspace membership. Verify API health and the onboarding route before
deploying the web client.

Apply `019_semantic_cache_models.sql` before publishing model selection. The
model-scoped cache is separate from the legacy cache to keep a previous API
build from reading alternate-model answers during rollback.

Apply `020_workspace_model_policies.sql`, `021_model_usage_metadata.sql`, and
`022_workspace_embedding_indexes.sql` before publishing workspace routing and
embedding version support. These migrations add state and metadata. Embedding
activation is a separate operator workflow after the updated API is live.

## 2. Render API

The API is built from the repository root using `apps/api/Dockerfile`. Set at
least these environment variables in Render:

```text
DATABASE_URL=postgresql://...
OPENROUTER_API_KEY=...
ALLOWED_ORIGINS=https://YOUR-STATIC-SITE.onrender.com
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...       # backend only; optional for private originals
ADMIN_EMAILS=admin@example.com
DEMO_MODE=true
HOST=0.0.0.0
DAILY_USER_QA_LIMIT=30
SEMANTIC_CACHE_TTL_SECONDS=3600
USAGE_ALERT_THRESHOLD_USD=1
# Optional: use a 32+ character secret for anonymous quota hashing.
# USAGE_HASH_SECRET=...
```

Keep `RERANKER_PROVIDER=none` and `LANGSMITH_TRACING=false` for the lowest-cost
demo. Verify `GET /health` returns HTTP 200 after deployment.

Configure `CHAT_ADDITIONAL_MODELS` with at least one reviewed model and its
input/output price estimates to enable signed-in comparisons. Keep the
combined per-request budget configured. `EVAL_FAITHFULNESS_JUDGE_MODEL` enables
an owner-triggered evaluation of bundled public cases. Regular evaluation and
CI do not call the judge. Run the [Jina benchmark](../apps/api/evals/README.md)
with synthetic data before enabling external reranking for workspace retrieval.

Both API Dockerfiles install Poppler and Tesseract with English and Portuguese
language data and enable PDF OCR. Verify `capabilities.pdfOcr` in the health
response. OCR runs in the existing ingestion worker and uses its existing
upload authorization, quotas, and private originals. Set `PDF_OCR_ENABLED=false`
on the API service to disable the fallback if needed.

## 3. Render static site

Configure the static site from the repository root:

```text
Build command: npm ci && npm run build:web
Publish directory: apps/web/dist
```

Set only browser-safe build variables:

```text
VITE_API_BASE_URL=https://YOUR-API.onrender.com
VITE_DEMO_MODE=true
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Every `VITE_` value is included in client-side JavaScript. Do not add provider,
database, service-role, or administrative secrets with that prefix.

## Acceptance checks

- The API health endpoint returns 200.
- Search and Q&A work from the public URL.
- Public users cannot access ingestion or administrative routes.
- The API allows CORS only from the published frontend origin.
- Provider keys are absent from the repository, browser bundle, and logs.
- `npm run typecheck`, `npm test`, and evaluation gates pass before deploy.

## Before accepting real users

Keep the owner-only usage dashboard and budget threshold enabled. Add provider-
native token accounting, backups, retention policies, and a security review. Do
not expose direct database APIs or external tools before their authorization
policies and tests are in place.
