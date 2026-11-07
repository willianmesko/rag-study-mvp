# Product Backlog

This backlog separates completed demo capabilities from work that requires a
product decision, credentials, or additional operational cost.

## Completed

- Custom RAG with chunking, interchangeable embeddings, pgvector, hybrid
  retrieval (vector + keyword + RRF), basic prompt-injection filtering, and
  cited answers.
- Supabase Auth, asynchronous PDF/DOCX/TXT/Markdown ingestion, local text
  extraction, processing status, and job retry.
- Local Portuguese and English OCR for scanned PDFs, including mixed documents
  with selectable text. The ingestion timeline records duration, page counts,
  recognition confidence, and actionable failure messages. The Docker image
  verifies both languages on synthetic scanned PDFs during its build.
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
- Original uploads in Knowledge: workspace members can open retained PDFs or
  download the original bytes for the indexed revision. The API checks access
  and audits reads.
- Advanced ingestion: owners and editors can import public HTTPS pages or
  HTML uploads. Ingestion extracts available title and description, labels the
  detected language, and chunks HTML, Markdown, and DOCX using headings. PDFs
  keep page boundaries. URL downloads enforce public network destinations,
  content type, redirect limits, and byte and time budgets.
- Ingestion pipeline visualization: file received, extraction, chunking,
  security scan, embeddings, and vector persistence.
- RAG evidence visualization: validated citations and model context are shown
  separately. Ask and Search explain cosine similarity. Search and Processing
  offer bounded, redacted previews, and Processing samples only the current
  indexed revision for owners and editors.
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
- Workspace Control Center: six independent, role-aware sections and a signed-in
  workspace creation action with separate onboarding for each new space. The
  API requires explicit selection for accounts with multiple memberships.
- Resumable signed-in chat with ordered SSE replay, workspace and user scope,
  one quota charge per run, provider cancellation, and checked citations before
  fresh answer deltas. The replay window is 24 hours.
- Feature-Sliced Design frontend and npm-workspaces monorepo with shared Zod
  contracts in `packages/contracts`.
- Professional UX/UI first pass: shared design tokens and components, clearer
  information architecture, workspace-aware question/search flows, responsive
  layouts, keyboard-visible focus states, reduced-motion support, loading/
  empty/error/success states, animated ingestion progress, source inspection,
  and document/job filters in the administration area.
- Milo gives a short greeting on sign-in after the image loads. The greeting
  respects the device's reduced-motion preference.
- CI quality gates for every push and pull request: typecheck, unit tests,
  production builds, prompt-injection regression, deterministic golden-set
  retrieval, and Promptfoo security checks.
- Bounded agent safety baseline: structured answer parsing with Zod, retrieved
  citation validation, read-only tool allowlist definitions, step and timeout
  guards, configurable output-token limits, and an estimated per-request cost
  ceiling.
- Evaluation dashboard MVP: owner-only persisted evaluation runs with hit rate,
  MRR, injection pass rate, provider/model metadata, pass/fail thresholds, and
  historical run comparison. Faithfulness and context precision remain
  explicitly pending until an LLM judge or Ragas evaluator is connected.

## Delivery sequence

1. Advanced ingestion — complete for scanned PDF OCR, static public HTTPS
   pages, HTML uploads, metadata, language detection, and structured chunking.
2. RAG visualization — complete for citation and context separation, controlled
   previews, and score interpretation.
3. UX quality — responsive visual tests, contrast, accessibility, and team flows.
4. Workspace Control Center — complete for independent sections, additional
   workspace creation, explicit API selection, and tenant isolation checks.
5. Product expansion — demo datasets, backend history and feedback, invites,
   filters, and faithfulness evaluation.
6. Real-time chat — complete for connection recovery, persisted run state,
   provider cancellation, and streaming validated citations.
7. Portuguese and English — verify automatic UI locale and evaluate retrieval in
   both languages.
8. Onboarding — validate the standalone Milo flow and sync progress across devices.
9. Project-owned MCP — workspace-scoped read tools.

Run independent tasks within a milestone in parallel, integrate in this order,
and update this backlog after validating each shipped capability.

## Backlog by area

**Next product priority.** Add chat-model selection from a backend-owned
allowlist (item 9). Start with an explicitly configured workspace default and
make model availability, cost estimates, and quota behavior visible in Ask.

1. **Security and cost controls**
   - Capture provider-native token usage where each provider exposes it; current
     hosted-demo metrics use a documented character-based estimate.
   - Add external notification delivery for budget alerts if the demo grows
     beyond the owner-only dashboard.

2. **Improve ingestion**
   - The first advanced ingestion milestone is complete. Checkpointed ingestion
     and selective retries remain part of the LangGraph workflow expansion.

3. **RAG pipeline visualization**
   - The current UI shows passage counts and offers a bounded preview from a
     completed ingestion. Claim-to-source verification remains in the LangGraph
     workflow expansion.

4. **Retrieval quality and observability**
   - Evaluate Jina reranking against the golden set before enabling it.
   - Add LangSmith or Langfuse/Phoenix traces under an approved data policy.
   - Add OpenTelemetry spans by workflow stage, request correlation IDs,
     reason-coded logs and metrics, tool-call telemetry, alarms, and runbooks.
     Evaluate Splunk and VictoriaMetrics as operational backends when needed.
   - Compare providers and prompts with a versioned evaluation report.

5. **Production readiness**
   - The [backend scalability review](backend-scalability-review.md) records
     source findings and proposed capacity gates. Execute the mixed-workload
     benchmark before committing to a topology change.
   - Validate whether the current backend architecture meets projected scale.
     Define workload and service targets for active workspaces, concurrent chat
     streams, corpus size, and ingestion bursts. Load-test mixed traffic and
     measure p95 search and chat latency, time to first stream event, error
     rates, queue lag, database connection saturation, and cost per workload.
   - Compare tuning and scaling the current modular API with separating the
     ingestion worker. Include the effect of one busy workspace on others and
     distinguish database or worker bottlenecks from AI provider limits.
     Record the decision, evidence, cost trade-offs, and measurable triggers
     for revisiting it in an architecture decision record.
   - Review RLS policies again before exposing any new database API surface.
   - Move high-volume jobs to Redis + BullMQ and a dedicated worker only when
     the scalability review shows that the workload justifies the added cost.
   - Add backups, retention policy, domain, identity limits, and incident runbook
     before onboarding real users.

6. **Professional UX/UI hardening**
   - Implemented a shared responsive select for workspace switching, chat and
     search result limits, member roles, and processing filters.
   - Standardize button and menu-action states across the product. Enabled
     controls use a pointer cursor and visible hover and keyboard focus styles.
     Disabled and pending actions are visibly distinct and block activation.
   - Review English and Brazilian Portuguese product copy, including action
     labels, empty states, progress, errors, and confirmations. Use familiar
     workspace and document language, and explain how to recover from errors.
   - Run screenshot-based visual QA on mobile, tablet, and desktop in CI once a
     browser runner is available in the deployment pipeline.
   - Add a formal visual-regression baseline and automated contrast checks.
   - Continue refining member management and workspace onboarding with the same
     design tokens and state model.

7. **Workspace Control Center — complete**
   - The former `AdminPanel` is split into `Overview`, `Knowledge`,
     `Processing`, `Team`, `Evaluations`, and `Settings`. Each section has a
     stable route and independent data loading. Overview links to the full
     sections from summary cards.
   - **New workspace** in the signed-in header opens workspace creation and
     starts a separate setup guide. Switching preserves the current section
     when the role in the destination workspace can access it.
   - Viewers can open Overview, Knowledge, and Processing. Editors can manage
     documents. Owners can open Team, Evaluations, and Settings. The API
     validates explicit workspace selection and membership on private operations
     for accounts with multiple spaces.
   - Verified route loading and role guards in Chrome using fixture data, and
     verified workspace-specific citations, cache hits, quotas, and upload
     authorization with two corpora in a disposable PostgreSQL/pgvector database.

8. **Demo and product expansion**
   - Seed realistic starter corpora for separate `TI` and `Legal` workspaces so
     the tenant switcher can be demonstrated immediately.
   - Persist question history and thumbs-up/thumbs-down feedback in the backend,
     scoped by workspace and user, instead of keeping it only in the browser.
   - Extend the evaluation dashboard with faithfulness and context precision
     from an approved LLM judge or Ragas evaluation job.
   - Verify invitation delivery and onboarding with the existing Supabase Auth
     invitation endpoint. Configure a transactional sender if needed.
   - Add document filters for source, language, date range, and file type.
   - Add side-by-side model/prompt comparison for answer quality, latency, cost,
     citations, and safety outcomes.

9. **Model routing and comparative evaluation**
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
   - Add anonymized production replays and calibrate a judge against reviewed
     examples. Compare model and effort settings, including false-positive rates.

10. **LangGraph workflow expansion**
   - Add adaptive RAG: retrieve, apply a relevance gate, rewrite the query when
     evidence is weak, retry retrieval once, and refuse when evidence remains
     insufficient.
   - Citation IDs are already checked against passages sent to the model.
     Add claim-to-source verification and a bounded repair path for invalid
     citations before returning a refusal.
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

11. **Agent tools and MCP safety**
   - Add a project-owned MCP server with read-only workspace tools first:
     search, source inspection, ingestion status, and evaluation reports.
   - Enforce tenant scope, RBAC, schema validation, audit events, rate limits,
     timeouts, and explicit tool allowlists on every MCP call.
   - Isolate agent tool execution with a read-only runtime, scoped filesystem
     access, bounded tokens, cost and steps, and cancellation that stops work.
   - Add isolated execution for any future write-capable tool, with approval,
     idempotency keys, retries, dead-letter handling, and a replayable audit
     record.

12. **Infrastructure as code and AWS production reference**
   - Keep the low-cost Render/Supabase demo as the default deployment path.
   - Add Terraform roots and reusable modules for dev, staging, and production,
     with remote state, mandatory tags, least-privilege IAM, permission
     boundaries, and separate plan/apply approvals.
   - Add an optional AWS architecture reference:

     ```text
     CloudFront → API Gateway → Lambda → Step Functions
                                      ├── ingestion
                                      ├── retrieval
                                      ├── agent workflow
                                      └── evaluation replay

     DynamoDB → state and idempotency
     S3 → private source files
     Bedrock → embeddings and chat
     EventBridge → domain events
     CloudWatch → metrics and alarms
     ```

   - Document the mapping between the demo adapters and the AWS adapters before
     enabling any paid AWS resource.

13. **GitLab CI/CD compatibility**
   - Add a `.gitlab-ci.yml` equivalent to the GitHub quality harness.
   - Run typecheck, tests, build, security evals, golden set, Promptfoo, and
     Terraform validation as release gates.
   - Add environment-specific deploy jobs, manual production approval, stored
     evaluation artifacts, and rollback instructions.

14. **Resilient integrations**
   - Add idempotency keys and deduplication to uploads, ingestion jobs, model
     calls, and external notifications.
   - Standardize exponential-backoff retries, rate-limit handling, permanent
     failure classification, and stale-state detection.
   - Add an outbox pattern, dead-letter queue, replay commands, and operational
     runbooks for failed or partially delivered events.

15. **Project-owned MCP server**
   - Start with read-only `list_sources`, `get_ingestion_status`, and
     owner-only `get_quality_report`. Return allowlisted fields from existing
     records and require an explicit workspace with verified membership.
   - Add bounded `get_document` and `search_workspace` after defining safe
     passage previews, provider budgets, and cancellation.
   - Require tenant scope, RBAC, audit events, timeout and rate-limit guards,
     Zod schemas, and an explicit allowlist on every tool call.
   - Treat `run_evaluation` as an owner-authorized action with its own budget.
     It can call providers and persists results. Add approval-gated actions
     after isolated execution, idempotency, retries, dead-letter handling,
     and replayable audit records exist.

16. **Guided onboarding for non-technical teams**
   - Implemented a dedicated sign-in page, an explicitly separate public demo,
     and a standalone bilingual Milo guide before entering the private app.
     Users can create a workspace, choose a goal, optionally upload a document,
     and explore a sample answer and citation. The workspace opens after they
     finish the guide. Progress is saved per user and workspace in the browser.
   - Public demo search and chat use the configured demo corpus. Requests
     carrying a private workspace selector require authenticated membership.
   - Create a first-run, step-by-step onboarding flow for users who do not know
     RAG terminology or infrastructure concepts.
   - Start with a plain-language goal, for example: “Make your law firm’s
     internal materials searchable and answer questions with sources.”
   - Guide the user through workspace creation, use-case selection, inviting
     teammates, uploading the first documents, waiting for processing, and
     asking the first grounded question.
   - Explain key concepts at the moment they matter: documents, chunks,
     embeddings, retrieval, citations, similarity scores, and why similarity
     is not factual certainty.
   - Add a legal-workspace starter template with safe sample content, suggested
     questions, document naming guidance, and privacy/data-handling notes.
   - Persist onboarding progress so it can be resumed, skipped, or revisited
     from Help without blocking experienced users.
   - Make steps role-aware: owners configure the workspace, editors add
     knowledge, and viewers learn how to search and inspect sources.
   - Acceptance criteria: a new non-technical user can create a workspace,
     ingest a document, ask a question, and understand the cited answer without
     reading technical documentation.
   - Remaining: sync onboarding progress to the backend so it follows the user
     across browsers and devices.

17. **Real-time chat and streaming answers — complete**
   - Signed-in requests use an idempotent run ID and receive numbered SSE
     events. Reconnecting in the same tab resumes from the last received event.
     Reloading a tab with an active run replays its events from the beginning.
   - PostgreSQL persists run status, validated output, and ordered events for
     a 24-hour replay window. Membership and the run's actor are checked on
     every connection and cancellation. Raw questions and drafts are excluded
     from replay storage. The public demo remains transient.
   - Stop records a terminal state and aborts in-flight provider requests.
     Structured citations are verified before fresh answer deltas are released.
     Cached responses and refusals are delivered as terminal events.
   - The regular JSON endpoint remains available before SSE admission. Socket
     tests cover reconnection, quota deduplication, cancellation across API
     instances, safe provider failure, and authorization.
   - Follow-up under LangGraph workflow expansion: checkpoint work across a
     server restart. Current in-flight runs end as interrupted if their worker
     exits. Bidirectional collaboration remains a separate future feature.

18. **Portuguese and English support**
   - The interface now supports Brazilian Portuguese and English with automatic
     detection using the device time zone and browser language. Chat language
     fallback and multilingual retrieval evaluation remain follow-up work.
   - Localize the web interface in Brazilian Portuguese (`pt-BR`) and English
     (`en`), including onboarding, workspace navigation, chat statuses, errors,
     and empty states. Format dates and numbers for the selected locale.
   - Prefer Portuguese in recognized Portuguese-speaking time zones, then use
     browser language preferences. Default to English when neither signal
     resolves to a supported locale.
   - Detect the language of each question independently of the interface and
     answer in that language. Use the selected interface language when a
     question is short, ambiguous, or mixes languages without a clear majority.
   - Build on ingestion language detection to label documents as Portuguese,
     English, mixed, or unknown. Keep citation excerpts in the source language.
   - Add acceptance tests for automatic regional and browser selection, and
     English-to-Portuguese and Portuguese-to-English retrieval with grounded
     answers and citations.
