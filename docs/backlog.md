# Product Backlog

This backlog separates completed demo capabilities from work that requires a
product decision, credentials, or additional operational cost.

## Completed

- Custom RAG with chunking, interchangeable embeddings, pgvector, hybrid
  retrieval (vector + keyword + RRF), basic prompt-injection filtering, and
  cited answers.
- Supabase Auth, asynchronous PDF/DOCX/TXT/Markdown ingestion, local text
  extraction, processing status, and job retry.
- Private original-file storage, constrained upload size and MIME types, and a
  server-only storage adapter.
- Tenant isolation for documents and jobs. The tenant is derived from validated
  membership, never trusted from client input.
- Daily tenant question quota, daily administrator upload-byte quota, and an
  audit trail that contains identifiers and technical metadata, not question,
  document, or IP contents.
- Deterministic golden set, prompt-injection suite, unit tests, type checking,
  build verification, and GitHub Actions.
- Document management: list, inspect chunks, reindex from a private original,
  delete, clickable answer sources, and browser-local question feedback.
- Ingestion pipeline visualization: file received, extraction, chunking,
  security scan, embeddings, and vector persistence.
- Persisted ingestion timeline: stage start/end events, durations, safe counts,
  and errors are available to the protected administration UI without storing
  document content in the event stream.
- PII redaction before external embedding/chat providers, workspace-isolated
  semantic answer cache, per-user question quotas, estimated usage metrics,
  owner-only usage dashboard, and configurable budget alerts.
- Supabase RLS policies for authenticated workspace reads; backend-only tables
  remain inaccessible through the publishable Data API by design.
- Workspace onboarding, switching, `owner`/`editor`/`viewer` roles, invitations,
  member management, and server-side authorization on every protected route.
- Feature-Sliced Design frontend and npm-workspaces monorepo with shared Zod
  contracts in `packages/contracts`.
- Professional UX/UI first pass: shared design tokens and components, clearer
  information architecture, workspace-aware question/search flows, responsive
  layouts, keyboard-visible focus states, reduced-motion support, loading/
  empty/error/success states, animated ingestion progress, source inspection,
  and document/job filters in the administration area.
- CI quality gates for every push and pull request: typecheck, unit tests,
  production builds, prompt-injection regression, deterministic golden-set
  retrieval, and Promptfoo security checks.
- Evaluation dashboard MVP: owner-only persisted evaluation runs with hit rate,
  MRR, injection pass rate, provider/model metadata, pass/fail thresholds, and
  historical run comparison. Faithfulness and context precision remain
  explicitly pending until an LLM judge or Ragas evaluator is connected.

## Next, in priority order

1. **Security and cost controls**
   - Capture provider-native token usage where each provider exposes it; current
     hosted-demo metrics use a documented character-based estimate.
   - Add external notification delivery for budget alerts if the demo grows
     beyond the owner-only dashboard.

2. **Improve ingestion**
   - Add OCR for scanned PDFs. OCR (Optical Character Recognition) converts text
     inside an image into selectable, searchable text before chunking.
   - Support URL/HTML import, metadata extraction, language detection, and
     structure-aware chunking.
   - Add OCR-specific quality signals to the existing ingestion timeline.

3. **RAG pipeline visualization**
   - Add a limited, explicitly approved chunk preview to the existing timeline.
   - Keep the UI clear that a retrieval score is similarity, not factual
     certainty, and that a document can produce many chunks.

4. **Retrieval quality and observability**
   - Evaluate Jina reranking against the golden set before enabling it.
   - Add LangSmith or Langfuse/Phoenix traces under an approved data policy.
   - Compare providers and prompts with a versioned evaluation report.

5. **Production readiness**
   - Review RLS policies again before exposing any new database API surface.
   - Move high-volume jobs to Redis + BullMQ and a dedicated worker only when
     workload justifies its cost.
   - Add backups, retention policy, domain, identity limits, and incident runbook
     before onboarding real users.

6. **Professional UX/UI hardening**
   - Run screenshot-based visual QA on mobile, tablet, and desktop in CI once a
     browser runner is available in the deployment pipeline.
   - Add a formal visual-regression baseline and automated contrast checks.
   - Continue refining member management and workspace onboarding with the same
     design tokens and state model.

7. **Demo and product expansion**
   - Seed realistic starter corpora for separate `TI` and `Legal` workspaces so
     the tenant switcher can be demonstrated immediately.
   - Persist question history and thumbs-up/thumbs-down feedback in the backend,
     scoped by workspace and user, instead of keeping it only in the browser.
   - Stream grounded answers and citations to the frontend as the model runs.
   - Extend the evaluation dashboard with faithfulness and context precision
     from an approved LLM judge or Ragas evaluation job.
   - Deliver real workspace invitations through Supabase Auth email flows or a
     transactional provider such as Resend.
   - Add document filters for source, language, date range, and file type.
   - Add side-by-side model/prompt comparison for answer quality, latency, cost,
     citations, and safety outcomes.

8. **Model routing and comparative evaluation**
   - Add a backend-owned allowlist of chat models. The frontend may select only
     models exposed by the active workspace configuration; it must never submit
     an arbitrary provider model identifier.
   - Add chat-model selection per question and per evaluation run, with provider,
     model, prompt version, latency, token usage, estimated cost, citation
     validity, and injection pass rate recorded for every result.
   - Add side-by-side answer comparison for two allowlisted chat models, using
     the same retrieved context and prompt version so the comparison is fair.
   - Keep the embedding model fixed per index/workspace. Changing it requires an
     explicit embedding-version migration, dimension validation, semantic-cache
     invalidation, and a full document reindex before activation.
   - Configure reranking as an independent second-stage model. Evaluate Jina or
     another approved reranker against the golden set before enabling it.
   - Add model-routing policies for simple versus complex questions and provider
     fallback, with hard token, latency, and spend budgets enforced in code.
   - Add regression reports that compare the current run with the previous
     baseline and fail release gates when recall, precision, safety, latency, or
     cost crosses a configured threshold.

9. **LangGraph workflow expansion**
   - Add adaptive RAG: retrieve, apply a relevance gate, rewrite the query when
     evidence is weak, retry retrieval once, and refuse when evidence remains
     insufficient.
   - Add citation verification after generation. Accept only citations that
     refer to retrieved chunks; otherwise repair the answer or return a safe
     refusal.
   - Orchestrate advanced ingestion as a checkpointed graph: extraction, text
     quality gate, OCR fallback, metadata, language detection, structure-aware
     chunking, security scan, embeddings, and persistence. Retry only the failed
     node and preserve safe stage metrics.
   - Add an evaluation graph that runs retrieval metrics, answer generation,
     faithfulness, context precision, and security checks into one versioned
     report.
   - Add human-in-the-loop checkpoints for sensitive actions. The graph must
     pause after policy evaluation, persist the approval request, and resume only
     after an authorized user confirms it.
   - Add durable state, cancellation, step limits, timeouts, and per-run budgets
     so a misbehaving model cannot create an unbounded loop or spend indefinitely.

10. **Agent tools and MCP safety**
   - Add a project-owned MCP server with read-only workspace tools first:
     search, source inspection, ingestion status, and evaluation reports.
   - Enforce tenant scope, RBAC, schema validation, audit events, rate limits,
     timeouts, and explicit tool allowlists on every MCP call.
   - Add isolated execution for any future write-capable tool, with approval,
     idempotency keys, retries, dead-letter handling, and a replayable audit
     record.
