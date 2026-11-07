# Product Backlog

Lumora is a general-purpose knowledge workspace for teams across industries.
Goals and document types guide the experience. IT and legal scenarios are
optional study examples.

Last reviewed on 2026-11-07.

## Status guide

| Status | Meaning |
| --- | --- |
| [Completed](#completed-and-validated) | Implemented and validated. Deployment or execution limits are stated with the item. |
| [In progress](#in-progress) | Being implemented. Validation and publication are still required. |
| [Pending implementation](#pending-implementation) | Product or engineering work remains. |
| [Pending activation or live validation](#implemented-pending-activation-or-live-validation) | Supporting code exists. Configuration, operational setup, or measured evidence remains. |
| [Optional future expansion](#optional-future-expansion) | A separate infrastructure or product decision is required. |

Checked items are completed capabilities. Unchecked items remain open in the
status section where they appear.

## In progress

### Demonstration libraries, document filters, and prompt comparisons

The discovery milestone is implemented and locally validated: explicit,
workspace-scoped demo imports, suggested questions and sources, server-side
filters, controlled prompt variants, safety outcomes, and clearer evaluation
reference requirements. The quality harness and disposable PostgreSQL isolation
checks passed; responsive UX validation passed. Release checks and publication
are still required, so its completion checklist remains open.

**Approved delivery order**

1. [Demonstration libraries and document discovery](#1-demonstration-libraries-and-document-discovery):
   realistic synthetic materials, suggested questions with sources,
   document/source/language/date/type filters, and controlled prompt comparisons
   with safety outcomes.
2. [LangGraph workflow expansion](#2-langgraph-workflow-expansion): adaptive
   retrieval, claim verification and citation repair, checkpointed ingestion,
   unified evaluations, durable approvals, execution budgets/cancellation, and
   restart recovery. Start after the demonstration and discovery milestone is
   completed and validated.

The discovery milestone is in progress. LangGraph expansion remains next in the approved queue.

## Pending implementation

### 1. Demonstration libraries and document discovery

- [ ] Seed reusable demonstration libraries with realistic synthetic handbooks,
  procedures, FAQs, product guides, and project materials.
- [ ] Include suggested questions and supporting sources so teams can explore
  the product and compare separate workspaces.
- [ ] Add document filters for source/document, language, date range, and file
  type. Name/source text filtering already exists.
- [ ] Extend answer comparison to controlled prompt variants and safety outcomes.

### 2. LangGraph workflow expansion

- [ ] Add adaptive retrieval with a relevance gate, one bounded query rewrite
  and retrieval retry, and a refusal when evidence remains insufficient.
- [ ] Verify answer claims against source passages and add a bounded repair
  path for invalid citations. Citation-ID validation already exists.
- [ ] Run ingestion as a checkpointed graph covering extraction, text quality,
  OCR fallback, metadata, language, structure-aware chunking, security scanning,
  embeddings, and persistence. Retry the failed node and retain safe metrics.
- [ ] Add a unified evaluation graph for retrieval metrics, answer generation,
  faithfulness, context precision, security checks, and a versioned report.
- [ ] Add durable human-approval checkpoints for sensitive graph actions, with
  authorized approval before execution resumes.
- [ ] Extend durable state, cancellation, step/token limits, timeouts, and
  per-run budgets to the expanded workflows and their tools.
- [ ] Recover graph work across server restarts. Current in-flight chat runs
  become interrupted when their worker exits.

### 3. Durable conversations and product history

- [ ] Store named conversations, questions, answers, checked citations, and
  thumbs-up/thumbs-down feedback in the backend, scoped by workspace and user.
- [ ] Use durable conversation and message IDs, ordered messages, execution
  status, and model and usage metadata.
- [ ] Reopen conversations across signed-in devices. Support naming, renaming,
  pagination of older messages, and conversation deletion.
- [ ] Make message submission and completion idempotent so retries and stream
  reconnection preserve one ordered conversation.
- [ ] Validate membership and conversation ownership on every read, write,
  and feedback request.
- [ ] Define conversation visibility, retention, and deletion. Store content in
  authorized product records and preserve the log policy that excludes raw
  questions and document contents.

The current transcript lives in browser memory. Recent answers and ratings are
browser-local. PostgreSQL execution replay lasts 24 hours. Durable conversation
history is the open work described above.

### 4. Portuguese and English retrieval and answers

- [ ] Detect the question's language independently of the interface. Use the
  interface language for short, ambiguous, or mixed-language questions.
- [ ] Evaluate grounded retrieval and answers in Portuguese and English,
  including English-to-Portuguese and Portuguese-to-English searches.
- [ ] Extend locale acceptance coverage for time-zone/browser-language
  combinations and fallback behavior.

The bilingual interface, automatic locale selection, localized dates/numbers,
and document labels for Portuguese, English, mixed, and undetermined text are
implemented.

### 5. Observability, security, and cost controls

- [ ] Add OpenTelemetry spans by workflow stage, request correlation IDs,
  reason-coded logs/metrics, and tool-call telemetry.
- [ ] Add operational dashboards, alarms, and failure runbooks. Evaluate Splunk
  and VictoriaMetrics as backends when operational needs justify them.
- [ ] Extend provider-native token and cost coverage. Current records distinguish
  reported usage/cost from configured estimates.
- [ ] Deliver budget alerts by email or webhook. The owner-only dashboard alert
  is already implemented.
- [ ] Add Langfuse/Phoenix if selected as the tracing backend. A LangSmith adapter
  already exists and has a separate activation item below.

### 6. Production capacity and operations

- [ ] Execute the mixed-workload benchmark from the
  [backend scalability review](backend-scalability-review.md). Define targets
  for active workspaces, concurrent streams, corpus size, and ingestion bursts.
- [ ] Measure p95 search/chat latency, time to first stream event, error rates,
  queue lag, database connection saturation, and workload cost.
- [ ] Measure the effect of a busy workspace on others. Compare tuning/scaling
  the modular API with separating the ingestion worker, and identify database,
  worker, and provider limits separately.
- [ ] Record the measured architecture decision, cost trade-offs, and triggers
  for revisiting it in an architecture decision record.
- [ ] Review RLS policies before exposing each new database API surface.
- [ ] Resolve the existing Supabase advisories before onboarding real users.
  Review [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
  and the [vector extension schema](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public).
- [ ] Define and verify backups, retention, domain configuration, identity
  limits, and incident procedures for real-user operation.

### 7. Resilient integrations and future tool actions

- [ ] Extend idempotency keys and deduplication to uploads, ingestion jobs,
  model calls, and external notifications.
- [ ] Standardize exponential-backoff retries, rate-limit handling, permanent
  failure classification, and stale-state detection.
- [ ] Add an outbox, dead-letter handling, replay commands, and runbooks for
  failed or partially delivered events.
- [ ] Define effect-specific authorization, approval, execution isolation,
  idempotency, retries, replayable audits, and network egress policy before
  adding write-capable external tools.

### 8. MCP expansion

- [ ] Add remote MCP connections with OAuth for clients that connect by URL.
- [ ] Add hybrid workspace search with provider budgets and cancellation to
  MCP. The current MCP search is bounded PostgreSQL keyword search.
- [ ] Apply explicit allowlists, schemas, workspace scope, RBAC, rate limits,
  deadlines, budgets, and audit requirements to every new tool.

### 9. Workspace-owned evaluation datasets

- [ ] Add reviewed workspace-specific evaluation datasets and expected-source
  mappings. The fixed RAG reference benchmark measures its bundled corpus;
  public faithfulness examples do not certify a team's own documents.

## Implemented, pending activation or live validation

- [ ] Run the existing Jina benchmark with credentials and review measured
  quality and latency against the golden set before enabling reranking.
- [ ] Supply reviewed live latency/cost exports to activate release performance
  gates for a representative workload. Offline ranking/screening gates run now.
- [ ] Populate replay tooling with approved anonymized or reconstructed
  production cases and review receipts.
- [ ] Calibrate the judge against reviewed real cases and publish measured
  model, effort, provider, and prompt comparisons, including coverage and
  false-positive/false-negative rates. The public-fixture judge and calibration
  tooling are implemented.
- [ ] Validate an embedding-version cutover in the target environment before
  changing its live index. Staging, full rebuild, dimension checks, atomic
  activation, and cache invalidation are implemented.
- [ ] Enable and validate the existing LangSmith adapter only with credentials
  and an approved trace-data policy.
- [ ] Verify real invitation delivery and onboarding through the existing
  Supabase Auth invitation endpoint. Configure a transactional sender if needed.
- [ ] Provision a least-privilege connection and separately hosted worker before
  activating owner-approved `run_evaluation` actions in production. The fixed lexical
  evaluator, approval routes, isolated runtime, idempotency, fenced leases,
  bounded retries, dead-letter state, and replayable events are implemented and
  tested locally. This worker is disabled in the current demo.

## Optional future expansion

### Infrastructure and AWS

The low-cost Render/Supabase demo remains the deployment baseline.

- [ ] Add Terraform roots and reusable modules for development, staging, and
  production, with remote state, required tags, least-privilege IAM, permission
  boundaries, and separate plan/apply approvals.
- [ ] Document mappings between demo adapters and an optional AWS deployment
  before provisioning paid resources.
- [ ] Implement the AWS reference architecture when that path is selected.

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

### GitLab CI/CD

- [ ] Add a `.gitlab-ci.yml` equivalent to the existing GitHub quality harness.
- [ ] Run typecheck, tests, builds, security evals, golden set, Promptfoo, and
  Terraform validation as gates.
- [ ] Add environment-specific deployments, manual production approval,
  evaluation artifacts, and rollback instructions.

### Conditional scaling and collaboration

- [ ] Adopt Redis/BullMQ and a dedicated high-volume worker when measured queue,
  fairness, retry, or scheduling requirements justify the additional cost.
- [ ] Evaluate bidirectional collaboration, presence, and WebSockets when a
  collaborative product flow requires them. Current chat uses SSE.

## Completed and validated

### RAG and ingestion

- [x] Custom chunking, embedding-provider adapters, pgvector storage, hybrid
  vector/keyword retrieval with RRF, and cited answers.
- [x] Independent optional Jina reranker adapter and a credentialed comparison
  command. Live benchmark review remains in the activation section above.
- [x] Asynchronous PDF, DOCX, TXT, Markdown, and HTML ingestion with retries.
- [x] Portuguese/English OCR for scanned or mixed PDFs, with per-page handling,
  confidence, page counts, timing, and actionable errors. The Docker build tests
  both languages on synthetic scanned documents.
- [x] Public HTTPS page imports with public-network destination checks, allowed
  content types, bounded redirects, and byte/time budgets.
- [x] Title/description metadata, document-language detection, heading-based
  HTML/Markdown/DOCX chunking, and PDF page boundaries.
- [x] Private original-file storage, upload size/MIME checks, protected original
  PDF access/download, document listing, passage inspection, reindex, and delete.
- [x] Persisted ingestion-stage events, counts, durations, safe errors, timeline,
  and bounded completed-ingestion previews.
- [x] Separate views for validated citations and passages sent to the model,
  controlled redacted previews, source-language excerpts, and explanations of
  similarity scores.

### Authentication, workspaces, and safety

- [x] Supabase Auth, server-validated membership, owner/editor/viewer roles,
  invitation endpoints, member management, and authorization on protected routes.
- [x] Multiple memberships, workspace switching/creation, per-workspace onboarding,
  explicit private API selection for multi-workspace accounts, and isolation tests.
- [x] Workspace-scoped documents, retrieval, jobs, semantic cache, and quotas.
- [x] Authenticated member-read RLS and private backend tables with restricted
  Data API access.
- [x] Prompt-injection screening, PII redaction before external embedding/chat
  calls, Zod answer contracts, and retrieved-citation allowlisting.
- [x] Daily tenant/user question quotas, administrator upload-byte quotas,
  rate limits, provider deadlines, step/output-token guards, and estimated
  request-cost ceilings.
- [x] Audit records with identifiers and technical metadata, excluding raw
  questions, document contents, and IPs.
- [x] Owner usage dashboard, cache-hit/failure/latency metrics, reported provider
  usage where available, cost provenance, and dashboard budget alerts.

### Product UI and current chat behavior

- [x] One section heading/action, compact workspace navigation, lean Overview,
  document/member lists with action menus, invitation dialog, on-demand
  document/timeline side panels, and divided/collapsible Settings.
- [x] Ask fills the available column and remaining desktop viewport height.
  Desktop, tablet, and mobile checks pass. [Release quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42339025439)
  passed and frontend commit `84eccfa` was confirmed live on Render on 2026-11-07.
- [x] React/TypeScript Feature-Sliced Design, shared UI styles, responsive states,
  hover/focus/disabled/pending behavior, reduced-motion support, and bilingual copy.
- [x] Six independently loaded, role-aware workspace sections with routes and
  deep links.
- [x] Full-width app shell with desktop navigation at the left screen edge.
- [x] One workspace menu above navigation, showing the current name/role,
  workspace choices, and creation action. Keyboard, focus, and viewport tests pass.
- [x] Separate sign-in, public demo, and bilingual Milo onboarding with generic
  knowledge/support/learning goals and compatible earlier selections.
- [x] Reusable English/Portuguese fictional starter documents with preview,
  download, suggested grounded questions, naming guidance, and data-handling notes.
- [x] Role-aware guide: owners can invite, owners/editors can upload, and viewers
  use available documents. The guide follows actual preparation records and
  supports a real workspace question with checked citations and passage previews.
- [x] Expandable explanations of documents, chunks, embeddings, retrieval,
  citations, and similarity versus factual certainty.
- [x] Help reopens Milo's guide without resetting saved completion; early finish
  remains available. Guide actions use existing server quotas and authorization.
- [x] Responsive automated create → prepare → ask → inspect journeys, shared
  invitation checks, upload-error recovery, and safe starter reuse after deletion.
  These use isolated API fixtures; real email delivery remains an activation item.
  [Release quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42340958437)
  passed and frontend commit `14adeda` was confirmed live on Render on 2026-11-07.
- [x] Per-user/workspace onboarding progress in PostgreSQL, cross-device resume,
  scoped browser retry, and completion preserved across concurrent devices.
- [x] Milo sign-in greeting and workspace-loading animation, respecting reduced
  motion preferences.
- [x] Ask conversation bubbles, recent-question follow-ups, fresh retrieval and
  checked citations per reply, and a New chat action. The transcript stays in
  memory while navigating within the same active workspace.
- [x] Up to 20 browser-local recent answers and ratings, scoped by workspace/user.
- [x] Signed-in SSE with ordered events, reconnect/reload replay, provider
  cancellation, workspace/user checks, and one quota charge per run.
- [x] PostgreSQL run/event replay for 24 hours, checked citations before fresh
  answer deltas, safe terminal failures, JSON fallback, and transient public demo.
  Replay excludes raw questions and provider drafts.

### Models, evaluations, and delivery

- [x] Backend-owned workspace model allowlists, per-question selection, Auto
  routing/fallback, bounded attempts, and token/latency/price policies.
- [x] Side-by-side model answers using the same retrieved context and prompt,
  with model/provider, prompt version, citations, safety, latency, and usage data.
- [x] Workspace-pinned embedding versions and explicit full-index migration
  tooling with dimension checks and cache invalidation.
- [x] Golden set, prompt-injection suite, Promptfoo, unit tests, type checking,
  production builds, and GitHub Actions quality gates.
- [x] Versioned offline replay regression, reviewed-fixture receipts,
  recall/precision/safety comparisons, and configurable release performance gates.
- [x] Owner evaluation history with hit rate, MRR, injection pass rate, reviewed
  context precision, and optional public-fixture faithfulness/judge calibration.
- [x] Model/effort comparison tooling, coverage and false-positive metrics, and
  measurement exports. Live validation remains in its status section above.
- [x] Responsive Playwright journeys, Linux screenshot references, contrast/axe
  checks, overflow/layout checks, member confirmation, and workspace menu tests.
- [x] TypeScript npm-workspaces monorepo with `apps/web`, `apps/api`, and shared
  Zod contracts in `packages/contracts`, plus Clean Architecture backend ports.
- [x] Architecture documentation, deployment guidance, an MCP guide, and an
  initial backend scalability review.

### Project-owned MCP reads

- [x] Local stdio connector with `list_sources`, `get_ingestion_status`, owner-only
  `get_quality_report`, bounded `get_document`, and `search_workspace`.
- [x] Dedicated temporary credentials, revocation, current membership checks,
  explicit workspace binding, Zod schemas, allowlisted fields, safe excerpts,
  audits, call allowances, rate limits, deadlines, result caps, and cancellation.
- [x] PostgreSQL keyword search through a separate read-only pool, with no
  Lumora provider calls.
- [x] Scoped Node module reads and an optional nonroot, read-only container with
  operating-system resource limits for the fixed connector.
- [x] Owner credential UI in Settings and a
  [connection guide](workspace-mcp.md) with a worked example and runtime limits.

## Maintenance rule

Keep an item in In progress until the requested behavior and relevant checks
pass. Record an operational activation separately when code already exists.
Update this file after a validated delivery and retain the remaining open work.
