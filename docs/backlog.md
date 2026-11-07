# Product Backlog

Lumora is a general-purpose knowledge workspace for teams across industries.
Goals and document types guide the experience. IT and legal scenarios are
optional study examples.

Last reviewed on 2026-11-07.

The [resume checkpoint](backlog-resume.md) preserves the next FE-06 slice:
conversation read visibility/pagination. Technology-neutral module assembly
(BE-15), FE-06 administrative reads and BE-08 native TypeScript checks are
implemented, validated and published. The parent FE-06 and BE-08/FE-08 tickets
remain partial. The learning
walkthrough retains its saved starting point; teaching sessions remain pending.

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

The latest application release, `2fcd1215a1f6c8f8cdd10039d23814616d394db6`, is
live on the frontend and API after all four
[CI gates passed](https://github.com/willianmesko/rag-study-mvp/actions/runs/42405593398).
Both deployments, served features/icon, health and protected routes were verified
on 2026-11-07. See [query-ownership release evidence](operations/release-2026-11-07-query-ownership.md).
The previous [capability-boundary release](operations/release-2026-11-07-capability-boundaries.md)
remains documented separately.
The earlier [module-organization release](operations/release-2026-11-07-architecture-phase2.md)
is retained as historical evidence.
The earlier [observability/resilience release](operations/release-2026-11-07.md)
is included.

The [technical backlog](technical-backlog.md) records 15 published tickets,
six partial tickets and five pending tickets. The published
batch includes shared success-response schemas, SQL limits, bounded Auth/member
lookup, frontend composition/Public APIs, provider reservations, safe shutdown
and NestJS-inspired business-module organization. See the
[module guide](backend-modules.md) and [ADR 0002](decisions/0002-business-modules.md).
**BE-15 now separates tool-neutral feature assembly from concrete database,
provider, workflow and tracing selection.** It is included in the live SHA above.
Its [release evidence](operations/release-2026-11-07-capability-boundaries.md)
records 78 architecture fixtures, 83 real PostgreSQL checks, the cutover and the
complete harness. That prior CI also passed 247 UX cases with 44 deliberate
profile skips. The latest bounded delivery improves administrative query ownership
and native TypeScript checks; its CI passed 274 UX cases and production checks
passed. See its
[release record](operations/release-2026-11-07-query-ownership.md). Conversation
read visibility, pagination and transport ownership remain the next FE-06 slice.
Operational activation remains separate.

OAuth extension-parameter compatibility and standard MCP icon metadata are live.
A real completed ChatGPT connection still needs client consent/verification.

**Approved delivery order**

1. **Completed:** [Demonstration libraries and document discovery](#1-demonstration-libraries-and-document-discovery).
2. **Completed:** [LangGraph workflow expansion](#2-langgraph-workflow-expansion): adaptive
   retrieval, claim verification and citation repair, checkpointed ingestion,
   unified evaluations, durable approvals, execution budgets/cancellation, and
   restart recovery.
3. **Completed:** [MCP expansion](#8-mcp-expansion): OAuth URL connections,
   workspace hybrid retrieval, durable budgets/cancellation and safe tool policies.

## Pending implementation

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

### 9. Workspace-owned evaluation datasets

- [ ] Add reviewed workspace-specific evaluation datasets and expected-source
  mappings. The fixed RAG reference benchmark measures its bundled corpus;
  public faithfulness examples do not certify a team's own documents.

### 10. Technical architecture and code quality

The [backend review](backend-architecture-review.md) and
[frontend review](frontend-architecture-review.md) record code evidence,
alternatives, trade-offs and validation. The authoritative task checklist is the
[technical backlog](technical-backlog.md), with explicit completed/partial/pending
slices. The audit itself is complete; phase 1 adds no dependency or database
migration and preserves the existing stack.

- [x] Implement phase 1 HTTP/JSON transport corrections, credential-free cache
  identity, local section recovery, idle-pool handling, logical key inventory,
  full-window budget repair and a required embedding cutover CI job. Local
  regressions and four successful CI jobs are recorded in the phase 1 release
  evidence. Frontend and API are live at `a590360`. Full success-payload validation
  and SQL deadlines remain in progress.
- [x] Extract cohesive Auth/HTTP/app responsibilities, decode successful JSON
  resources, add slice Public APIs and a proven FSD/module graph gate. CI and
  both deployments passed at `d045949`. Broader promise/Hook checks remain partial.
- [x] Complete feature-owned backend modules for Identity, Workspaces, Knowledge,
  Ingestion, Chat, AI, Evaluations, MCP, Usage and product Workflows. Group each
  capability's controllers, services/use cases, ports and adapters; keep technical
  facilities under `platform` and global composition under `app`. Preserve the
  current framework, public API and resource ownership, and validate module
  exports/dependencies automatically before deployment.
- [x] **BE-15, implemented, validated and published:** make feature factories depend on
  repository/service/workflow/tracing/provider ports and plain options. Select
  PostgreSQL, Supabase, LangGraph, LangSmith, Ollama/OpenRouter/Bedrock and optional
  reranker adapters in outer composition. Add alternate-adapter contract tests
  and architecture gates; preserve transaction, budget and compatibility behavior.
- [ ] Finish BE-12 typed feature configuration and SQL row decoding; shared wire
  schemas alone do not close that backend work.
- [ ] Standardize query/stream transitions, cancellation, least-privilege MCP
  credentials, reranker reservations, shutdown and dependency/build hygiene
  (phase 3).
- [ ] Consolidate current UI primitives/tokens, measure browser/backend capacity
  and improve forms/URL state only where evidence justifies it (phase 4).

Keep the established stack. Library/tool adoption requires the documented pilot;
neither the review nor a new package replaces tests or server authorization.

### 11. Guided end-to-end learning walkthrough

Requested after the modular-architecture delivery. Follow the
[learning walkthrough](learning-walkthrough.md) through the actual code, module
by module, starting with Node.js/TypeScript and RAG fundamentals.

- [ ] Conduct the guided product/request walkthrough, including every current
  feature and its frontend/API/data/provider path.
- [ ] Explain ingestion/OCR, chunking, embeddings, hybrid retrieval/reranking,
  grounded answers, LangGraph, conversations, streaming and MCP through examples.
- [ ] Inspect authorization, tenant isolation, prompt-injection defenses, PII,
  encryption, cost accounting/budgets, caching, evaluations and observability.
- [ ] Walk through local setup, tests, CI, deployment, failure recovery and
  architecture/cost trade-offs; identify active, inactive and pending capabilities.
- [ ] Use diagrams, verified code links and safe local exercises in each chapter;
  persist learning progress and questions. Complete the capstone only when the
  learner can explain and modify the flow, rather than after a summary is written.

The reference plan is in English; interactive explanations can be in Portuguese.
No real client documents, production mutations or paid calls are required for
routine lessons. This teaching work does not interrupt the current implementation.

## Implemented, pending activation or live validation

- [ ] Configure the selected OTLP trace/metrics receiver and operational alarm
  delivery. The local Collector/Jaeger/Prometheus/Grafana configuration and
  reason-coded signals are implemented. Langfuse/Phoenix remain conditional on
  backend selection; Splunk/VictoriaMetrics are deferred until operations justify them.
- [ ] Activate a signed budget-webhook destination, verify its timestamp/HMAC and
  idempotency handling, and confirm a real delivery using a release containing
  BE-04's full-window repair. No destination was invented.
- [ ] Activate versioned workflow writer keys through staged rollout, complete
  a target-environment inventory and rehearse restoring a real retained backup
  before retiring reader keys. Use BE-01's logical-key traversal and its fresh
  inventory protocol, not older physical-cursor releases.
  Current legacy-key compatibility is preserved.
- [ ] Supply reviewed embedding/reranker billing rates where provider dollar
  measurements are unavailable. New unpriced usage is flagged, and historical
  measurements are unchanged.


- [ ] Complete a real connection in the user's chosen remote assistant after
  interactive consent. The SDK authorization/discovery/PKCE/refresh and MCP
  transports are integration-tested; third-party account consent is not
  automatically performed by deployment.

- [ ] Run the existing Jina benchmark with credentials and review measured
  quality and latency against the golden set before enabling reranking. Resolve
  BE-10's conservative reservation policy before paid production activation.
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
  activation, and cache invalidation are implemented. BE-05 must execute its
  dedicated integration suite in CI without skips first.
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

### 5. Observability, security, and cost controls

- [x] Versioned AES-GCM workflow envelopes, active writer/retained reader keys,
  legacy compatibility, a bounded resumable rotation CLI and staged rotation
  runbook. Real PostgreSQL checks cover all four encrypted stores, bounded
  progress, authentication/tampering and reading after old-key retirement.
- [x] Manual OpenTelemetry spans for workflow stages, provider effects, MCP tools
  and HTTP, server-generated correlation IDs retained on workflow admission,
  reason-coded outcomes, bounded labels and content-free operational logging.
- [x] Local collector/traces/metrics configuration, a provisioned operations
  dashboard, Prometheus alarm rules and failure runbooks. Collector validation,
  alarm firing tests and real synthetic OTLP-to-Prometheus/Jaeger checks passed.
- [x] New ledger coverage for document/query embeddings, enabled reranking,
  evidence/evaluation judges and evaluation generation. Native tokens and reported
  zero costs are preserved, configured estimates are identified, unknown prices
  are explicit, and completed-effect replay cannot duplicate ledger receipts.
  No historical provider measurements were fabricated or rewritten.
- [x] Signed budget-webhook outbox, bounded leased delivery, Retry-After/backoff,
  dead letters, safe attempt history and current-owner replay through API/CLI.

### 7. Resilient integrations and future tool actions

- [x] Workspace/actor-scoped upload keys and input fingerprints, deterministic
  private originals with byte verification, atomic byte quota/job/queued-event
  admission, conflict detection and safe cleanup after uncertain commits.
- [x] Delayed capped ingestion admission, active-workflow exclusion, exhausted
  admission detection, fenced leases and retained failed-job recovery.
- [x] Durable provider-effect and usage receipts, bounded known-rejection retries
  under original deadlines/call budgets, permanent classification and safe holds
  for unknown paid outcomes. There is no claim of provider-side exactly-once.
- [x] Stable signed webhook delivery IDs, jittered backoff, stale lease recovery,
  deduplicated owner replay, a dead-letter outbox and a recovery runbook.
- [x] Idempotent Supabase Auth invitation journal, bounded transport, concurrent
  request protection, atomic membership/invitation/completion, current-owner
  checks, stale-state detection and holds for uncertain email delivery. Private
  recipient records have retention; operational audits exclude email content.
- [x] Effect-specific prerequisites documented for future external write tools:
  explicit authorization/approval, isolated execution, scoped egress, budgets,
  idempotency, retries, reconciliation and replayable audits. MCP write, SQL,
  shell and notification tool names remain denied even to an owner.

The local harness passed, along with 54 real PostgreSQL integration checks,
142 responsive browser checks and 19 focused usage/invitation checks (the
focused set overlaps the full suite). Public provider/mail delivery is mocked
in tests. All three CI gates passed and the frontend/API are live at `e25572d`.
The [release record](operations/release-2026-11-07.md) preserves migration,
deployment and smoke-test evidence for that version. Phase 1 now implements
BE-01/BE-04 with concurrent-inventory and extended-repair-window regressions;
its release status is recorded in the technical backlog. Operational activation
remains separate.
See [operations](operations/observability.md),
[rotation](operations/workflow-key-rotation.md) and
[integration recovery](operations/integration-recovery.md).


### 1. Demonstration libraries and document discovery

- [x] Three reusable bilingual demonstration libraries for knowledge, support,
  and learning, each with five realistic fictional handbooks, procedures, FAQs,
  product guides, and project materials. Preview/download is provider-free;
  owner/editor imports are explicit, workspace-scoped, quota-limited, audited,
  and replay-safe. Concurrent requests preserve existing documents and jobs.
- [x] Suggested questions name their supporting sources, become available after
  indexing, and open an editable draft in Ask. Members can inspect added
  documents. Viewers can preview and ask without gaining upload rights.
- [x] Server-side document/source text, exact document, language, file type,
  and inclusive UTC updated-date filters, applied before the 100-result cap.
  Invalid dates and scope overrides are rejected; SQL parameters are bound.
- [x] Controlled Balanced/Concise/Explanatory prompt comparisons with one allowed
  model, or model comparisons with one shared prompt. Both use identical
  prepared evidence and bounded execution. Results record prompt version,
  provider/model, tokens, latency, cost provenance, citations, and safety outcome.
  Measurement exports exclude conversation/excerpt text and free-form refusals.
- [x] Explicit preparation of the fixed RAG reference benchmark, preflight
  rejection when its source is absent, and clearer separation of retrieval,
  scored-case coverage, public faithfulness examples, and judge calibration.
  Historical results remain unchanged. Private-corpus datasets remain pending.
- [x] Dialog-safe dropdowns, mobile header wrapping, readable date controls,
  responsive screenshot references, and request logs excluding filter values,
  addresses, headers, and upstream error text.

The quality harness, all three
[release quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42354260305),
75 responsive browser checks, and 14 real PostgreSQL integration checks passed.
Browser journeys use isolated API fixtures. Backend and frontend commit
`f9bdd41` were confirmed live on Render on 2026-11-07, with health,
authentication boundaries, page routes, and deployed feature assets verified.
No production workspace was automatically seeded and no new provider was
activated. See [Demonstration and discovery](demonstration-discovery.md).

### 2. LangGraph workflow expansion

- [x] Add adaptive retrieval with a relevance gate, one bounded query rewrite
  and retrieval retry, and a refusal when evidence remains insufficient.
- [x] Verify answer claims against source passages and add a bounded repair
  path for invalid citations. Citation-ID validation already exists.
- [x] Run ingestion as a checkpointed graph covering extraction, text quality,
  OCR fallback, metadata, language, structure-aware chunking, security scanning,
  embeddings, and persistence. Retry the failed node and retain safe metrics.
- [x] Add a unified evaluation graph for retrieval metrics, answer generation,
  faithfulness, context precision, security checks, and a versioned report.
- [x] Add durable human-approval checkpoints for sensitive graph actions, with
  authorized approval before execution resumes.
- [x] Extend durable state, cancellation, step/token limits, timeouts, and
  per-run budgets to the expanded workflows and their tools.
- [x] Recover authenticated chat, ingestion, and evaluations across worker
  changes within the original deadline and remaining resource budget.

Native LangGraph checkpoints and completed provider effects are encrypted,
workspace/user scoped, fenced by renewable leases, and retained for 24 hours.
The real PostgreSQL suite covers node recovery, quota/event deduplication,
cancellation, deleted sources, durable owner approval, and a single persisted
report. The evaluation center exposes safe progress and approval controls;
Processing offers cancellation. Direct CLI imports, JSON/anonymous chat, and
comparisons remain bounded synchronous paths. A lexical rewrite is deterministic;
claim judging is evidence assessment, not proof. Private corpus datasets,
provider-complete actual billing, key rotation, and capacity testing remain open.
All three [release quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42359824117)
passed for code commit `9f179be`. Local validation also passed the quality harness,
22 real PostgreSQL checks, and 78 applicable browser checks (30 intentionally
restricted to other viewports). The additive Supabase migration and private-table
permissions were verified. API and frontend were confirmed live on Render on
2026-11-07; API health advertised durable workflows, protected operations rejected
unauthenticated access, and the served frontend included approval/cancellation.
The public Q&A smoke request safely refused because its public corpus lacked
relevant context; live private-model generation was not exercised through an
impersonated account. Native recovery/provider tests use isolated fixtures.
See [Durable workflows](durable-workflows.md).

### 3. Durable conversations and product history

- [x] Store named conversations, questions, answers, checked citations, and
  thumbs-up/thumbs-down feedback in the backend, scoped by workspace and user.
- [x] Use durable conversation and message IDs, ordered messages, execution
  status, and model and usage metadata.
- [x] Reopen conversations across signed-in devices. Support naming, renaming,
  pagination of older messages, and conversation deletion.
- [x] Make message submission and completion idempotent so retries and stream
  reconnection preserve one ordered conversation.
- [x] Validate membership and conversation ownership on every read, write,
  and feedback request.
- [x] Define conversation visibility, retention, and deletion. Store content in
  authorized product records and preserve the log policy that excludes raw
  questions and document contents.

Conversations are private to their author within each workspace, retained for
90 days after the last submitted message, and removed with linked replay and
workflow state when deleted. New signed-in history is backend-owned; anonymous
demo history remains browser-local. Saved comparisons preserve both results;
a comparison interrupted by a server restart expires safely instead of silently
repeating provider calls. See [Durable conversations](durable-conversations.md)
for contracts, diagrams, privacy/deletion rules, and operational limits.

Validation: 13 real PostgreSQL/API checks, seven focused browser journeys across
three responsive profiles, accessibility checks, and the evaluation harness
passed locally. The Supabase migration and private-role checks are complete.
All three release gates and frontend/backend publication passed at `603ee63`;
the latest `e25572d` release retains that functionality.

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
- [x] Granular recorded answer costs by provider/model, operation and UTC day;
  7/30/90-day windows; tokens, average/P95 response times, reuse, skipped
  generation and failures; reported versus estimated amounts; and aggregate
  JSON export. A single scoped SQL snapshot reconciles every partition, preserves
  historical estimates, and honors reported zero costs without double counting.
  Owner/workspace checks, real PostgreSQL reconciliation and responsive journeys
  passed locally. All three [release quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42361785953)
  passed for `d5ab209`, including 23 PostgreSQL checks and 81 applicable responsive
  browser checks. API and frontend were confirmed live on Render on 2026-11-07;
  health, protected routes and served feature assets passed verification. No
  schema migration or historical rewrite was needed. That version recorded
  answers only; the later `e25572d` release adds new embedding/reranking/judge
  records with reported/estimated/unpriced distinctions. Reviewed rates and
  provider-native coverage activation remain separate above.

### Product UI and current chat behavior

- [x] Invitation access uses two immediately visible native radio choices,
  Viewer/Editor, with short descriptions and Viewer selected by default.
  The choice remains usable in Team, onboarding and the nested Help guide;
  keyboard navigation, focus return and pending-state locks are validated.
  Twelve responsive checks and eight additional WebKit/Firefox checks passed.
  All three [release quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42365583647)
  passed for `344ab76`, including 111 applicable browser checks and 24 PostgreSQL
  checks. The frontend deploy `dep-dbng6gbm8hqs73c4je10` was confirmed live on
  2026-11-07. Published desktop/English and mobile/Portuguese UI checks used
  isolated session/member fixtures and confirmed both choices and selection;
  no real invitations were sent. Served assets and API health were checked.
- [x] Ask-first navigation without numbered page labels; normal sign-in and
  completed onboarding open chat while authorized private deep links remain.
- [x] Document-aware chat entry: loading, empty, preparing, failed and ready
  states use actual indexed passages and all workspace jobs, independently of
  paginated admin lists. Empty document rows do not unlock questions.
- [x] Protected file/URL intake from chat and Knowledge uses one shared dialog.
  Owners/editors can add documents; viewers get team guidance and anonymous
  demo visitors get a sign-in action. File selection alone never uploads.
- [x] No new question/comparison is submitted while knowledge is unavailable.
  Visible preparation is polled and the composer unlocks automatically when
  ready. Re-entering chat rechecks cached availability after source deletion.
  Existing messages and active cancellation controls remain accessible.
- [x] One refreshed open-book/light SVG asset for the app mark and favicon.
  All three [release quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42364069688)
  passed for `3f60bbf`, including 24 PostgreSQL checks and 99 applicable browser
  checks. Updated visual references cover desktop, tablet and mobile.
  API and frontend were confirmed live on Render on 2026-11-07. Production
  desktop/English and mobile/Portuguese checks verified Ask-first navigation,
  the empty public library, automatic locale, the new SVG/favicon, protected
  private routes and zero automatic question calls. No new API errors were
  recorded in the verification window. No schema or secret changes were needed.
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
- [x] Ask conversation bubbles, server-owned recent-question context, fresh
  retrieval, checked citations, and a New chat action. Signed-in conversations
  persist across navigation and devices; see the durable-history item above.
- [x] Up to 20 browser-local recent demo answers and ratings. Signed-in product
  history and ratings now use private backend records.
- [x] Signed-in SSE with ordered events, reconnect/reload replay, provider
  cancellation, workspace/user checks, and one quota charge per run.
- [x] PostgreSQL run/event replay for 24 hours, checked citations before fresh
  answer deltas, safe terminal failures, JSON fallback, and transient public demo.
  Replay excludes raw questions and provider drafts.

- [x] One main onboarding task per phase, upload first with an optional sample,
  processing replacing the upload form, and one ready confirmation. Model and
  prompt controls remain in the main chat; the glossary is in Help. Owner
  invitations follow the first grounded reply.
- [x] Finishing the guide opens the same saved conversation in the main chat.
  Continue later records valid resumable setup state without requiring a file.
- [x] Separate owner-only `/workspace/usage` route with independent cost queries;
  Settings retains workspace profile and policies. Both services were confirmed
  live at `603ee63` after all release gates passed.

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

### 8. MCP expansion

- [x] Remote MCP HTTP connections with OAuth authorization-code + S256 PKCE,
  explicit workspace/tool consent, rotating refresh tokens and revocable grants.
- [x] Hybrid workspace retrieval with a pinned/priced embedding identity,
  PostgreSQL text search, pgvector and RRF; atomic user/workspace provider
  budgets and cancellation propagated to embedding and SQL operations.
- [x] Shared allowlists, strict Zod contracts, workspace scope, current RBAC,
  durable rate/call budgets, deadlines, output caps, safe previews and audits.
- [x] Connected-assistant management for every member role, plus responsive
  PT/EN consent, sign-in return, expiry, decline and revocation states.
- [x] Publish the API and verify public OAuth discovery, resource challenge,
  authentication, CORS and invalid-token/form rejection (`266fdaf`).
- [x] Publish the frontend and verify the public connection and consent UI
  (`8af43a1`), including return from sign-in before onboarding is complete.

Validation on 2026-11-07: 35 PostgreSQL integration checks, full OAuth
discovery/DCR/PKCE/refresh using the official MCP SDK, modern and legacy
transports, concurrent/replay/cancellation tests, 18 connection UX cases,
and the full [release quality gates](https://github.com/willianmesko/rag-study-mvp/actions/runs/42369767912) passed.
Live checks confirmed OAuth discovery, access rejection, CORS, no-store,
iframe denial and the deployed consent bundle. EN/PT browser smoke checks
used synthetic authenticated fixtures and issued no real assistant grant.
The first third-party account connection remains an interactive consent
step, listed separately under live validation. Usage survives membership
removal/rejoining and failed/cancelled provider attempts remain charged
against the reserved budget. See the [connection guide](workspace-mcp.md).

### Project-owned MCP reads

- [x] Local stdio connector with `list_sources`, `get_ingestion_status`, owner-only
  `get_quality_report`, bounded `get_document`, and `search_workspace`.
- [x] Dedicated temporary credentials, revocation, current membership checks,
  explicit workspace binding, Zod schemas, allowlisted fields, safe excerpts,
  audits, call allowances, rate limits, deadlines, result caps, and cancellation.
- [x] Hybrid semantic/keyword search through a separate read-only pool, with one
  budgeted, redacted query embedding and no chat generation or reranker calls.
- [x] Scoped Node module reads and an optional nonroot, read-only container with
  operating-system resource limits for the fixed connector.
- [x] Connection management for all member roles, optional temporary keys and a
  [connection guide](workspace-mcp.md) with a worked example and runtime limits.

## Maintenance rule

Keep an item in In progress until the requested behavior and relevant checks
pass. Record an operational activation separately when code already exists.
Update this file after a validated delivery and retain the remaining open work.
